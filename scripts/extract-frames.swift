// Exact frame extraction from a video, via AVFoundation. Run by `build-frame-sequence.mjs`.
//
//   swift scripts/extract-frames.swift <video> <outDir> <all|1,5,9,...> [maxWidth]
//
// **Why this exists rather than ezgif or ffmpeg.** ffmpeg is not installed here and is not a
// dependency this repo wants; ezgif is a web service that decodes and *re-encodes* on its own
// terms — the previous frame set came back at 30fps from 24fps source, so 60 of its 300 frames
// were byte-identical repeats, and every frame had been through an extra compression generation.
// AVFoundation ships with macOS, decodes the original H.264 once, and hands back the exact frame
// at the exact presentation time with no intermediate encode.
//
// `requestedTimeTolerance*` are both `.zero`, which is the whole point: without it the generator
// returns the nearest keyframe, so asking for frame 37 can hand you frame 24. That failure is
// silent and looks exactly like footage that stalls.
//
// Frames are written as PNG — lossless, because the only compression that should ever touch these
// is the WebP the pipeline emits at the end.

import AVFoundation
import CoreImage
import Foundation
import ImageIO
import UniformTypeIdentifiers

let args = CommandLine.arguments
guard args.count >= 4 else {
    FileHandle.standardError.write("usage: extract-frames.swift <video> <outDir> <all|i,j,k> [maxWidth]\n".data(using: .utf8)!)
    exit(2)
}
let videoPath = args[1]
let outDir = URL(fileURLWithPath: args[2], isDirectory: true)
let spec = args[3]
let maxWidth = args.count >= 5 ? Int(args[4]) : nil

let sem = DispatchSemaphore(value: 0)
var failure: String?

Task {
    defer { sem.signal() }
    do {
        let asset = AVURLAsset(url: URL(fileURLWithPath: videoPath))
        guard let track = try await asset.loadTracks(withMediaType: .video).first else {
            failure = "no video track"; return
        }
        let fpsFloat = try await track.load(.nominalFrameRate)
        let duration = CMTimeGetSeconds(try await asset.load(.duration))
        let fps = Int32((Double(fpsFloat)).rounded())
        let total = Int((Double(fpsFloat) * duration).rounded())

        // `probe` reports the shape of the file and writes nothing, so the pipeline can size
        // itself before it decodes anything.
        if spec == "probe" {
            let size = try await track.load(.naturalSize).applying(try await track.load(.preferredTransform))
            print("{\"frames\":\(total),\"fps\":\(fps),\"width\":\(Int(abs(size.width))),\"height\":\(Int(abs(size.height)))}")
            return
        }

        let indices: [Int] = spec == "all"
            ? Array(0..<total)
            : spec.split(separator: ",").compactMap { Int($0) }

        let gen = AVAssetImageGenerator(asset: asset)
        // Rotation metadata applied, so a portrait-flagged source comes out upright rather than
        // sideways — the kind of thing that is obvious in the result and invisible in the code.
        gen.appliesPreferredTrackTransform = true
        gen.requestedTimeToleranceBefore = .zero
        gen.requestedTimeToleranceAfter = .zero
        if let w = maxWidth { gen.maximumSize = CGSize(width: w, height: 0) }

        try FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)

        for i in indices {
            // Sampled at the middle of the frame's interval rather than its leading edge. On the
            // boundary, floating-point rounding can land a hair either side and return the
            // neighbour; half a frame in is unambiguous.
            let t = CMTime(value: CMTimeValue(i * 2 + 1), timescale: fps * 2)
            let (cg, _) = try await gen.image(at: t)
            let out = outDir.appendingPathComponent(String(format: "frame-%04d.png", i + 1))
            guard let dest = CGImageDestinationCreateWithURL(
                out as CFURL, UTType.png.identifier as CFString, 1, nil
            ) else { failure = "cannot write \(out.path)"; return }
            CGImageDestinationAddImage(dest, cg, nil)
            guard CGImageDestinationFinalize(dest) else { failure = "encode failed at \(i)"; return }
        }
        print("extracted \(indices.count) of \(total) frames at \(fps)fps -> \(outDir.path)")
    } catch {
        failure = "\(error)"
    }
}
sem.wait()

if let f = failure {
    FileHandle.standardError.write("extract-frames: \(f)\n".data(using: .utf8)!)
    exit(1)
}
