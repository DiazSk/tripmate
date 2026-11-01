Pod::Spec.new do |s|
  s.name           = 'FilmNowPlaying'
  s.version        = '1.0.0'
  s.summary        = 'The story film as an iOS Now Playing player'
  s.description    = 'MPNowPlayingInfoCenter metadata and MPRemoteCommandCenter commands for the narrated story film'
  s.license        = 'UNLICENSED'
  s.author         = 'TripMate'
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '17.0' }
  s.source         = { git: '' }
  s.frameworks     = 'MediaPlayer', 'AVFAudio'

  s.dependency 'ExpoModulesCore'

  s.static_framework = true
  s.source_files = "**/*.{h,m,swift}"
end
