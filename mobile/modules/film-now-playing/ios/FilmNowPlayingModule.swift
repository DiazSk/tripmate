import AVFAudio
import ExpoModulesCore
import MediaPlayer
import UIKit

/// `NowPlayingInfo` in `src/lib/nowPlaying.ts`, field for field.
struct NowPlayingRecord: Record {
  @Field var title: String = ""
  @Field var artist: String = ""
  @Field var album: String = ""
  @Field var artworkUrl: String? = nil
  @Field var durationMs: Double = 0
  @Field var elapsedMs: Double = 0
  @Field var playing: Bool = false
  @Field var trackIndex: Int = 1
  @Field var trackCount: Int = 1
}

/**
 * The story film as iOS's own Now Playing player: the Dynamic Island, the Lock Screen and Control
 * Center draw it from the metadata published here, tinted from the artwork, and their buttons come
 * back as `onCommand` events. The narration itself stays `expo-speech`; nothing here speaks.
 *
 * **The silent loop is what keeps the film the Now Playing app.** Between sentences the narrator is
 * quiet for up to 700ms, and a speech synthesiser is not a media player iOS will hand the Lock Screen
 * to. A zeroed buffer looping on an `AVAudioEngine` while the film plays holds both; it stops on
 * pause, so a paused film keeps nothing awake.
 *
 * Each stop is published as its own track (`nowPlaying.ts`), so Next reads as the next stop and a stop
 * changing looks like a track changing. Elapsed time and rate are published together, so iOS animates
 * the scrubber between updates.
 */
public class FilmNowPlayingModule: Module {
  private var engine: AVAudioEngine?
  private var node: AVAudioPlayerNode?
  private var commands: [(MPRemoteCommand, Any)] = []
  private var artworkUrl: String?
  private var artwork: MPMediaItemArtwork?
  private var observers: [NSObjectProtocol] = []
  /// Whether the film is playing, as last published: what the silent loop should be doing.
  private var playing = false

  public func definition() -> ModuleDefinition {
    Name("FilmNowPlaying")

    Events("onCommand")

    AsyncFunction("start") { (info: NowPlayingRecord) in
      self.start(info)
    }.runOnQueue(.main)

    AsyncFunction("update") { (info: NowPlayingRecord) in
      self.publish(info)
    }.runOnQueue(.main)

    AsyncFunction("stop") {
      self.stop()
    }.runOnQueue(.main)

    // The island goes to the app that is producing audio at the moment it is left. A loop that iOS
    // stopped a moment ago (a reconfiguration, before the next sentence republished) would lose it.
    OnAppEntersBackground {
      DispatchQueue.main.async { if self.playing { self.keepAlive(true) } }
    }

    OnDestroy {
      DispatchQueue.main.async { self.stop() }
    }
  }

  private func start(_ info: NowPlayingRecord) {
    let session = AVAudioSession.sharedInstance()
    // Not mixable, or iOS will not give the Lock Screen to this app.
    // `.default`, the mode expo-audio's `setAudioModeAsync` sets on every play and pause: a different
    // mode here made each of those calls a reconfiguration, which stops the silent loop, and the app
    // left in the gap before the next sentence was not the one playing, so the island never came.
    try? session.setCategory(.playback, mode: .default, options: [])
    try? session.setActive(true)
    if commands.isEmpty { register() }
    if observers.isEmpty { observe() }
    publish(info)
  }

  private func publish(_ info: NowPlayingRecord) {
    var now: [String: Any] = [
      MPMediaItemPropertyTitle: info.title,
      MPMediaItemPropertyArtist: info.artist,
      MPMediaItemPropertyAlbumTitle: info.album,
      MPMediaItemPropertyPlaybackDuration: info.durationMs / 1000,
      MPNowPlayingInfoPropertyElapsedPlaybackTime: info.elapsedMs / 1000,
      MPNowPlayingInfoPropertyPlaybackRate: info.playing ? 1.0 : 0.0,
      MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.audio.rawValue,
      // Each stop is a track: where it sits in the day, for CarPlay, the Watch and VoiceOver.
      MPNowPlayingInfoPropertyPlaybackQueueIndex: max(0, info.trackIndex - 1),
      MPNowPlayingInfoPropertyPlaybackQueueCount: info.trackCount,
    ]
    // The last photograph stays until the next one lands, so the art changes rather than blanking.
    if let artwork { now[MPMediaItemPropertyArtwork] = artwork }
    MPNowPlayingInfoCenter.default().nowPlayingInfo = now
    playing = info.playing
    keepAlive(info.playing)
    loadArtwork(info.artworkUrl)
  }

  private func stop() {
    playing = false
    for (command, target) in commands { command.removeTarget(target) }
    commands = []
    for observer in observers { NotificationCenter.default.removeObserver(observer) }
    observers = []
    MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    silence()
    artworkUrl = nil
    artwork = nil
    // Lets the music the film paused carry on. Deactivating fails (`isBusy`) while the speech
    // synthesiser is still letting go of the output after `Speech.stop()`, and a swallowed failure
    // would leave the other app paused, so it is tried once more a moment later.
    do {
      try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    } catch {
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in
        guard self?.commands.isEmpty ?? true else { return } // a new film started meanwhile
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
      }
    }
  }

  private func register() {
    let center = MPRemoteCommandCenter.shared()
    let wired: [(MPRemoteCommand, String)] = [
      (center.playCommand, "play"),
      (center.pauseCommand, "pause"),
      (center.togglePlayPauseCommand, "toggle"),
      (center.nextTrackCommand, "next"),
      (center.previousTrackCommand, "previous"),
    ]
    for (command, name) in wired {
      command.isEnabled = true
      let target = command.addTarget { [weak self] _ in
        self?.sendEvent("onCommand", ["command": name])
        return .success
      }
      commands.append((command, target))
    }
    // Without these off, iOS draws skip-15 buttons in place of previous and next, and a scrubber
    // that seeks; a beat is entered from its first sentence, so the film has neither.
    center.skipForwardCommand.isEnabled = false
    center.skipBackwardCommand.isEnabled = false
    center.changePlaybackPositionCommand.isEnabled = false
    center.seekForwardCommand.isEnabled = false
    center.seekBackwardCommand.isEnabled = false
  }

  /// A phone call, Siri or an alarm, and headphones taken out, pause the film as they pause music:
  /// they arrive as `pause`, so the film stops at the word it was on and resumes there on Play.
  private func observe() {
    let center = NotificationCenter.default
    observers.append(center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
      guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
            AVAudioSession.InterruptionType(rawValue: raw) == .began else { return }
      self?.sendEvent("onCommand", ["command": "pause"])
    })
    // iOS stops the engine itself whenever the audio setup changes; start it again at once rather
    // than at the next sentence, so the film never sits silent while it should be playing.
    observers.append(center.addObserver(forName: .AVAudioEngineConfigurationChange, object: nil, queue: .main) { [weak self] _ in
      guard let self, self.playing else { return }
      self.keepAlive(true)
    })
    observers.append(center.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] note in
      guard let raw = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
            AVAudioSession.RouteChangeReason(rawValue: raw) == .oldDeviceUnavailable else { return }
      self?.sendEvent("onCommand", ["command": "pause"])
    })
  }

  /// Stopped outright, not paused: a paused node on a running engine is still audio output to iOS,
  /// and a paused film must let the app be suspended.
  private func silence() {
    node?.stop()
    engine?.stop()
    node = nil
    engine = nil
  }

  private func keepAlive(_ on: Bool) {
    guard on else {
      silence()
      return
    }
    // iOS stops the engine itself on an interruption, a change of headphones or a media-services
    // reset, and `play()` on a stopped engine raises an exception Swift cannot catch. So a loop that
    // is not running is built again, on a session made active again (a Lock Screen Play can arrive
    // in an app iOS had suspended).
    if engine?.isRunning != true {
      silence()
      try? AVAudioSession.sharedInstance().setActive(true)
      let engine = AVAudioEngine()
      let node = AVAudioPlayerNode()
      guard let format = AVAudioFormat(standardFormatWithSampleRate: 44_100, channels: 1),
            let zeros = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 44_100),
            let samples = zeros.floatChannelData else { return }
      zeros.frameLength = 44_100
      for i in 0..<Int(zeros.frameLength) { samples[0][i] = 0 }
      engine.attach(node)
      engine.connect(node, to: engine.mainMixerNode, format: format)
      do { try engine.start() } catch { return }
      node.scheduleBuffer(zeros, at: nil, options: .loops)
      self.engine = engine
      self.node = node
    }
    node?.play()
  }

  /// Fetched once per URL and attached when it lands, unless the beat has moved on by then.
  private func loadArtwork(_ url: String?) {
    guard let url, url != artworkUrl, let address = URL(string: url) else { return }
    artworkUrl = url
    URLSession.shared.dataTask(with: address) { [weak self] data, _, _ in
      guard let data, let image = UIImage(data: data) else { return }
      let art = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
      DispatchQueue.main.async {
        guard let self, self.artworkUrl == url else { return }
        self.artwork = art
        var now = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
        guard !now.isEmpty else { return }
        now[MPMediaItemPropertyArtwork] = art
        MPNowPlayingInfoCenter.default().nowPlayingInfo = now
      }
    }.resume()
  }
}
