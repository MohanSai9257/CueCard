import AppKit
import CoreGraphics
import Foundation
import ScreenCaptureKit

let pid = Int32(CommandLine.arguments[1])!
let outputPath = CommandLine.arguments[2]
let expectedWidth = Double(CommandLine.arguments[3])!
let expectedHeight = Double(CommandLine.arguments[4])!
let windows = CGWindowListCopyWindowInfo(.optionAll, kCGNullWindowID) as? [[String: Any]] ?? []
let ownWindows = windows.filter {
    guard ($0[kCGWindowOwnerPID as String] as? Int32) == pid,
          let bounds = $0[kCGWindowBounds as String] as? [String: Any],
          let width = bounds["Width"] as? Double, let height = bounds["Height"] as? Double else { return false }
    return abs(width - expectedWidth) < 2 && abs(height - expectedHeight) < 2
}
let sharingStates = ownWindows.compactMap { $0[kCGWindowSharingState as String] as? Int }
func emit(_ data: [String: Any]) {
    print(String(data: try! JSONSerialization.data(withJSONObject: data, options: [.sortedKeys]), encoding: .utf8)!)
}
if #available(macOS 14.0, *) {
    Task {
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
            guard let window = content.windows.first(where: { $0.owningApplication?.processID == pid && abs($0.frame.width - expectedWidth) < 2 && abs($0.frame.height - expectedHeight) < 2 }) else {
                emit(["nativeSharingStates": sharingStates, "listedByScreenCaptureKit": false])
                exit(0)
            }
            let config = SCStreamConfiguration()
            if CommandLine.arguments.count > 5, CommandLine.arguments[5] == "display" {
                guard let display = content.displays.first(where: { $0.frame.intersects(window.frame) }) else { exit(2) }
                config.width = display.width
                config.height = display.height
                let image = try await SCScreenshotManager.captureImage(contentFilter: SCContentFilter(display: display, excludingWindows: []), configuration: config)
                let bitmap = NSBitmapImageRep(cgImage: image)
                let scaleX = Double(image.width) / display.frame.width
                let scaleY = Double(image.height) / display.frame.height
                var markerPixels = 0
                var testedPixels = 0
                for y in stride(from: 24.0, to: window.frame.height - 24, by: 24) {
                    for x in stride(from: 24.0, to: window.frame.width - 24, by: 24) {
                        let pixelX = Int((window.frame.minX - display.frame.minX + x) * scaleX)
                        let pixelY = Int((window.frame.minY - display.frame.minY + y) * scaleY)
                        guard pixelX >= 0, pixelY >= 0, pixelX < image.width, pixelY < image.height,
                              let color = bitmap.colorAt(x: pixelX, y: pixelY)?.usingColorSpace(.deviceRGB) else { continue }
                        testedPixels += 1
                        if color.redComponent > 0.7 && color.greenComponent < 0.25 && color.blueComponent > 0.6 ||
                           color.greenComponent > 0.7 && color.redComponent < 0.25 && color.blueComponent < 0.5 { markerPixels += 1 }
                    }
                }
                emit(["nativeSharingStates": sharingStates, "fullDisplayMarkerFraction": Double(markerPixels) / Double(max(1, testedPixels)), "sampleCount": testedPixels])
                exit(0)
            }
            config.width = Int(window.frame.width)
            config.height = Int(window.frame.height)
            let image = try await SCScreenshotManager.captureImage(contentFilter: SCContentFilter(desktopIndependentWindow: window), configuration: config)
            let representation = NSBitmapImageRep(cgImage: image)
            try representation.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: outputPath))
            var visiblePixels = 0
            var testedPixels = 0
            for y in stride(from: 24, to: image.height - 12, by: 16) {
                for x in stride(from: 24, to: image.width - 12, by: 16) {
                    guard let color = representation.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB) else { continue }
                    testedPixels += 1
                    if color.alphaComponent > 0.1 && max(color.redComponent, max(color.greenComponent, color.blueComponent)) > 0.15 { visiblePixels += 1 }
                }
            }
            emit(["nativeSharingStates": sharingStates, "listedByScreenCaptureKit": true, "capturedByScreenCaptureKit": true, "visibleContentFraction": Double(visiblePixels) / Double(max(1, testedPixels)), "screenshot": outputPath])
            exit(0)
        } catch {
            emit(["nativeSharingStates": sharingStates, "captureError": error.localizedDescription])
            exit(1)
        }
    }
    RunLoop.main.run()
}
