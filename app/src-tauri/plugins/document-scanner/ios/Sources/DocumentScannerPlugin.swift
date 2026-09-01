import Tauri
import UIKit
import VisionKit
import WebKit

struct ScanArgs: Decodable {
  var maxPages: Int?
}

/// Presents Apple VisionKit VNDocumentCameraViewController and returns perspective-corrected JPEG pages.
class DocumentScannerPlugin: Plugin, VNDocumentCameraViewControllerDelegate {
  private var invoke: Invoke?
  private var maxPages: Int = 8

  @objc public func isAvailable(_ invoke: Invoke) {
    invoke.resolve(["available": VNDocumentCameraViewController.isSupported])
  }

  @objc public func scan(_ invoke: Invoke) throws {
    let args = try? invoke.parseArgs(ScanArgs.self)
    self.maxPages = max(1, min(args?.maxPages ?? 8, 8))
    self.invoke = invoke

    guard VNDocumentCameraViewController.isSupported else {
      invoke.reject("VisionKit document camera is not supported on this device")
      return
    }

    DispatchQueue.main.async {
      let scanner = VNDocumentCameraViewController()
      scanner.delegate = self
      guard let presenter = self.topViewController() else {
        invoke.reject("No view controller available to present scanner")
        self.invoke = nil
        return
      }
      presenter.present(scanner, animated: true)
    }
  }

  private func topViewController() -> UIViewController? {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    let window = scenes
      .flatMap { $0.windows }
      .first { $0.isKeyWindow } ?? scenes.first?.windows.first
    var top = window?.rootViewController
    while let presented = top?.presentedViewController {
      top = presented
    }
    return top
  }

  private func encodePage(_ image: UIImage) -> [String: Any]? {
    // Prefer full-resolution JPEG; avoid aggressive re-compression.
    guard let data = image.jpegData(compressionQuality: 0.95) else { return nil }
    let b64 = data.base64EncodedString()
    let size = image.size
    let scale = image.scale
    return [
      "dataUrl": "data:image/jpeg;base64,\(b64)",
      "width": Int(size.width * scale),
      "height": Int(size.height * scale),
    ]
  }

  public func documentCameraViewController(
    _ controller: VNDocumentCameraViewController,
    didFinishWith scan: VNDocumentCameraScan
  ) {
    controller.dismiss(animated: true)
    var pages: [[String: Any]] = []
    let count = min(scan.pageCount, maxPages)
    for index in 0..<count {
      let image = scan.imageOfPage(at: index)
      if let encoded = encodePage(image) {
        pages.append(encoded)
      }
    }
    invoke?.resolve(["pages": pages, "cancelled": false])
    invoke = nil
  }

  public func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) {
    controller.dismiss(animated: true)
    invoke?.resolve(["pages": [], "cancelled": true])
    invoke = nil
  }

  public func documentCameraViewController(
    _ controller: VNDocumentCameraViewController,
    didFailWithError error: Error
  ) {
    controller.dismiss(animated: true)
    invoke?.reject(error.localizedDescription)
    invoke = nil
  }
}

@_cdecl("init_plugin_document_scanner")
func initPlugin() -> Plugin {
  return DocumentScannerPlugin()
}
