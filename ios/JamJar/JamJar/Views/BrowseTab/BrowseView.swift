import SwiftUI
import WebKit

struct BrowseView: View {
    let serverURL: String
    let jwt: String?

    var body: some View {
        WebViewRepresentable(serverURL: serverURL, jwt: jwt)
            .ignoresSafeArea()
    }
}

struct WebViewRepresentable: UIViewRepresentable {
    let serverURL: String
    let jwt: String?

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true

        let refreshControl = UIRefreshControl()
        refreshControl.addTarget(context.coordinator, action: #selector(Coordinator.refresh(_:)), for: .valueChanged)
        webView.scrollView.refreshControl = refreshControl

        context.coordinator.webView = webView
        loadWithCookie(webView: webView)
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        if context.coordinator.lastJWT != jwt {
            context.coordinator.lastJWT = jwt
            loadWithCookie(webView: webView)
        }
    }

    private func loadWithCookie(webView: WKWebView) {
        guard let url = URL(string: serverURL) else { return }

        if let jwt, let cookie = HTTPCookie(properties: [
            .name: "jam_session",
            .value: jwt,
            .domain: url.host ?? "",
            .path: "/",
            .secure: serverURL.hasPrefix("https") ? "TRUE" : "FALSE",
        ]) {
            webView.configuration.websiteDataStore.httpCookieStore.setCookie(cookie) {
                webView.load(URLRequest(url: url))
            }
        } else {
            webView.load(URLRequest(url: url))
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    class Coordinator: NSObject, WKNavigationDelegate {
        weak var webView: WKWebView?
        var lastJWT: String?

        @objc func refresh(_ sender: UIRefreshControl) {
            webView?.reload()
            sender.endRefreshing()
        }

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
            if let url = navigationAction.request.url,
               navigationAction.navigationType == .linkActivated,
               url.host != webView.url?.host {
                await UIApplication.shared.open(url)
                return .cancel
            }
            return .allow
        }
    }
}
