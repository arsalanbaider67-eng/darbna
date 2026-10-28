// MapTemplateConverter.swift
// Converts JS config dictionaries to CPMapTemplate properties.
// Handles: CPMapButton, CPBarButton, CPBarButtonStyle, PanDirection,
// and CPBarButtonProviding (leadingNavigationBarButtons, trailingNavigationBarButtons).
// See: docs/carplay-api-surface.md §2 — Map Template & Map Buttons

import CarPlay

enum MapTemplateConverter {
    static func buildBarButtons(from configs: [BarButtonConfig]) -> [CPBarButton] {
        configs.compactMap { config in
            let id = config.id
            let handler: (CPBarButton) -> Void = { _ in
                CarPlayEventEmitter.shared.emit("onBarButtonPressed", ["id": id])
            }

            let button: CPBarButton
            if let systemImage = config.systemImage,
               let image = UIImage(systemName: systemImage) {
                button = CPBarButton(image: image, handler: handler)
            } else if let title = config.title {
                button = CPBarButton(title: title, handler: handler)
            } else {
                return nil
            }

            // `.none` and `nil` both fall through here — CPBarButton's
            // framework default is no style, which matches both cases.
            if case .rounded = config.style {
                button.buttonStyle = .rounded
            }

            button.isEnabled = config.enabled
            return button
        }
    }

    static func buildMapButtons(from configs: [MapButtonConfig]) -> [CPMapButton] {
        configs.compactMap { config in
            let id = config.id
            let button = CPMapButton { _ in
                CarPlayEventEmitter.shared.emit("onMapButtonPressed", ["id": id])
            }

            // title vs systemImage is two optional fields with a prefer-one fallback;
            // not a discriminated union. When the Navigation pilot models
            // ManeuverConfig.symbolImage, that's where the EitherType convention lands.
            if let title = config.title {
                let bgColor = config.backgroundColor.flatMap { ColorConverter.color(from: $0) } ?? .systemBlue
                button.image = renderPillImage(title: title, backgroundColor: bgColor)
            } else if let systemImage = config.systemImage {
                button.image = UIImage(systemName: systemImage)
            }

            button.isEnabled = config.enabled
            button.isHidden = config.hidden
            return button
        }
    }

    // MARK: - Pill Image Rendering

    private static func renderPillImage(title: String, backgroundColor: UIColor) -> UIImage {
        let font = UIFont.boldSystemFont(ofSize: 24)
        let textAttributes: [NSAttributedString.Key: Any] = [
            .font: font,
            .foregroundColor: UIColor.white
        ]
        let textSize = (title as NSString).size(withAttributes: textAttributes)
        let padding = UIEdgeInsets(top: 12, left: 24, bottom: 12, right: 24)
        let imageSize = CGSize(
            width: textSize.width + padding.left + padding.right,
            height: textSize.height + padding.top + padding.bottom
        )

        let renderer = UIGraphicsImageRenderer(size: imageSize)
        return renderer.image { _ in
            let rect = CGRect(origin: .zero, size: imageSize)
            let path = UIBezierPath(roundedRect: rect, cornerRadius: imageSize.height / 2)
            backgroundColor.setFill()
            path.fill()

            let textRect = CGRect(
                x: padding.left,
                y: padding.top,
                width: textSize.width,
                height: textSize.height
            )
            (title as NSString).draw(in: textRect, withAttributes: textAttributes)
        }
    }
}
