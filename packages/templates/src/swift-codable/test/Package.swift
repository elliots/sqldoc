// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "sqldoc-test",
    targets: [
        .executableTarget(name: "sqldoc-test", path: "Sources")
    ]
)
