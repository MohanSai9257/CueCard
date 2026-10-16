import AVFoundation
import CoreMedia
import Foundation
import ScreenCaptureKit

func report(_ event: String, _ message: String = "") {
    let data = try! JSONSerialization.data(withJSONObject: ["event": event, "message": message])
    FileHandle.standardError.write(data + Data([10]))
}

@available(macOS 14.2, *)
final class AudioCapture: NSObject, SCStreamOutput, SCStreamDelegate {
    var stream: SCStream?
    let outputQueue = DispatchQueue(label: "com.cuecard.system-audio")

    func start() async throws {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard let display = content.displays.first else {
            throw NSError(domain: "CueCard", code: 1, userInfo: [NSLocalizedDescriptionKey: "No display is available for system audio capture."])
        }
        let filter = SCContentFilter(display: display, excludingWindows: [])
        let config = SCStreamConfiguration()
        config.capturesAudio = true
        config.excludesCurrentProcessAudio = true
        config.sampleRate = 16000
        config.channelCount = 1
        config.width = 2
        config.height = 2
        config.minimumFrameInterval = CMTime(value: 1, timescale: 1)
        let capture = SCStream(filter: filter, configuration: config, delegate: self)
        // Register only audio output: no screenshots or video frames leave this process.
        try capture.addStreamOutput(self, type: .audio, sampleHandlerQueue: outputQueue)
        stream = capture
        try await capture.startCapture()
        report("ready")
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio, sampleBuffer.isValid,
              let description = CMSampleBufferGetFormatDescription(sampleBuffer),
              let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(description) else { return }
        // ScreenCaptureKit's configured mono output is native float32 PCM.
        guard asbd.pointee.mFormatFlags & kAudioFormatFlagIsFloat != 0,
              asbd.pointee.mBitsPerChannel == 32, asbd.pointee.mChannelsPerFrame == 1,
              asbd.pointee.mSampleRate == 16000 else {
            report("error", "macOS returned an unsupported system audio format.")
            exit(2)
        }
        var block: CMBlockBuffer?
        var list = AudioBufferList(mNumberBuffers: 1, mBuffers: AudioBuffer(mNumberChannels: 1, mDataByteSize: 0, mData: nil))
        let status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(sampleBuffer, bufferListSizeNeededOut: nil,
            bufferListOut: &list, bufferListSize: MemoryLayout<AudioBufferList>.size,
            blockBufferAllocator: nil, blockBufferMemoryAllocator: nil, flags: 0, blockBufferOut: &block)
        guard status == noErr, let data = list.mBuffers.mData, list.mBuffers.mDataByteSize > 0 else { return }
        FileHandle.standardOutput.write(Data(bytes: data, count: Int(list.mBuffers.mDataByteSize)))
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        report("error", error.localizedDescription)
        exit(1)
    }
}

if #available(macOS 14.2, *) {
    let capture = AudioCapture()
    Task {
        do { try await capture.start() }
        catch { report("error", error.localizedDescription); exit(1) }
    }
    RunLoop.main.run()
} else {
    report("error", "Native system audio requires macOS 14.2 or later.")
    exit(1)
}
