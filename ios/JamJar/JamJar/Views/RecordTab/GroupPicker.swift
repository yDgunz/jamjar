import SwiftUI

struct GroupPicker: View {
    let groups: [UserGroup]
    @Binding var selectedGroupId: Int?

    var body: some View {
        if groups.count > 1 {
            Picker("Group", selection: $selectedGroupId) {
                ForEach(groups) { group in
                    Text(group.name).tag(Optional(group.id))
                }
            }
            .pickerStyle(.menu)
        }
    }
}
