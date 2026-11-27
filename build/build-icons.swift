import AppKit
import Foundation
// Development-only vector rasterizer. No app or user-profile access.
let destination = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "assets/icons"
try FileManager.default.createDirectory(atPath: destination, withIntermediateDirectories: true)
for size in [16, 32, 48, 128] {
 let n = CGFloat(size)
 let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
 let context = NSGraphicsContext(bitmapImageRep: bitmap)!
 NSGraphicsContext.saveGraphicsState(); NSGraphicsContext.current = context
 context.cgContext.setShouldAntialias(true)
 let inset = n * 0.025
 let box = NSRect(x: inset, y: inset, width: n - inset*2, height: n-inset*2)
 let path = NSBezierPath(roundedRect: box, xRadius: n*0.25, yRadius: n*0.25)
 let light = NSColor(srgbRed: 0.70, green: 0.97, blue: 0.85, alpha: 1)
 let dark = NSColor(srgbRed: 0.42, green: 0.84, blue: 0.67, alpha: 1)
 NSGradient(starting: light, ending: dark)!.draw(in: path, angle: -70)
 NSColor(srgbRed: 0.86, green: 1, blue: 0.94, alpha: 0.65).setStroke()
 path.lineWidth = max(0.5,n/100);path.stroke()
 let attributes: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: n*0.64, weight: .heavy), .foregroundColor: NSColor(srgbRed: 0.07, green: 0.23, blue: 0.18, alpha: 1)]
 let text = "Q" as NSString, bounds = text.size(withAttributes: attributes)
 text.draw(at: NSPoint(x: (n-bounds.width)/2, y: (n-bounds.height)/2+n*0.015), withAttributes: attributes)
 NSGraphicsContext.restoreGraphicsState()
 let png = bitmap.representation(using: .png, properties: [:])!
 try png.write(to: URL(fileURLWithPath: destination).appendingPathComponent("icon-\(size).png"))
}
