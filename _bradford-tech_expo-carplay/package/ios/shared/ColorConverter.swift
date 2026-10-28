// ColorConverter.swift
// Parses color strings into UIColor.
// Supports hex ("#RRGGBB", "#RRGGBBAA") and UIKit semantic names ("systemTeal", "systemRed").

import UIKit

enum ColorConverter {
    static func color(from string: String) -> UIColor {
        if string.hasPrefix("#") {
            return parseHex(string) ?? .systemBlue
        }
        return namedColor(string) ?? .systemBlue
    }

    private static func parseHex(_ hex: String) -> UIColor? {
        var hexStr = hex
        if hexStr.hasPrefix("#") {
            hexStr = String(hexStr.dropFirst())
        }

        guard hexStr.count == 6 || hexStr.count == 8 else { return nil }

        var rgbValue: UInt64 = 0
        guard Scanner(string: hexStr).scanHexInt64(&rgbValue) else { return nil }

        if hexStr.count == 6 {
            return UIColor(
                red: CGFloat((rgbValue & 0xFF0000) >> 16) / 255.0,
                green: CGFloat((rgbValue & 0x00FF00) >> 8) / 255.0,
                blue: CGFloat(rgbValue & 0x0000FF) / 255.0,
                alpha: 1.0
            )
        } else {
            return UIColor(
                red: CGFloat((rgbValue & 0xFF00_0000) >> 24) / 255.0,
                green: CGFloat((rgbValue & 0x00FF_0000) >> 16) / 255.0,
                blue: CGFloat((rgbValue & 0x0000_FF00) >> 8) / 255.0,
                alpha: CGFloat(rgbValue & 0x0000_00FF) / 255.0
            )
        }
    }

    private static func namedColor(_ name: String) -> UIColor? {
        switch name {
        case "systemRed": .systemRed
        case "systemOrange": .systemOrange
        case "systemYellow": .systemYellow
        case "systemGreen": .systemGreen
        case "systemMint": .systemMint
        case "systemTeal": .systemTeal
        case "systemCyan": .systemCyan
        case "systemBlue": .systemBlue
        case "systemIndigo": .systemIndigo
        case "systemPurple": .systemPurple
        case "systemPink": .systemPink
        case "systemBrown": .systemBrown
        case "systemGray": .systemGray
        case "white": .white
        case "black": .black
        default: nil
        }
    }
}
