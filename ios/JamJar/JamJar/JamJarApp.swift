import SwiftUI
                                                                                                                                                              
 @main
 struct JamJarApp: App {
     var body: some Scene {
         WindowGroup {
             TabView {
                 Text("Record tab placeholder")
                     .tabItem {
                         Label("Record", systemImage: "record.circle")
                     }
                 Text("Browse tab placeholder")
                     .tabItem {
                         Label("Browse", systemImage: "globe")
                     }
                 Text("Settings tab placeholder")
                     .tabItem {
                         Label("Settings", systemImage: "gearshape")
                     }
             }
         }
     }
 }
