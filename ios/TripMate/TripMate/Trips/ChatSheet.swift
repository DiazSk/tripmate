import SwiftUI
import TripMateKit

/// Change the plan by asking.
///
/// **Thin on purpose.** `/api/trip-edit` applies the model's patch server-side and returns the
/// whole itinerary, so there is no `PatchOp` decoder here and no second copy of `applyPatch` to
/// keep in step with the web's. The entire client is: send the transcript, take the plan back.
///
/// The transcript is `TripsStore.chat` rather than local state, because the plan it edits lives
/// there and the two must not be able to disagree about which turns the server has seen.
struct ChatSheet: View {
    @Environment(TripsStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @FocusState private var writing: Bool

    /// Kept here, not in the store: it is only the text on its way in, and clearing it is the
    /// one thing that must wait for the send to succeed.
    @State private var draft = ""

    var body: some View {
        VStack(spacing: 0) {
            header
            transcript
            if !store.warnings.isEmpty { warningStrip }
            if let message = store.message { failure(message) }
            composer
        }
        .background(Token.surfaceDeep)
        .onAppear { writing = true }
    }

    private var header: some View {
        HStack {
            Text("Ask for a change")
                .textStyle(.heading)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button("Done") { dismiss() }
                .textStyle(.label)
                .foregroundStyle(Token.muted)
        }
        .padding(.horizontal, Token.padCompact)
        .frame(height: 56)
    }

    private var transcript: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: Token.gapRows) {
                    if store.chat.isEmpty { invitation }
                    ForEach(store.chat) { turn in
                        bubble(turn).id(turn.id)
                    }
                    if store.isReplying {
                        // No spinner: the wait is a model thinking, which has no denominator.
                        Text("Thinking…")
                            .textStyle(.detail)
                            .foregroundStyle(Token.muted)
                            .id(thinkingId)
                    }
                }
                .padding(.horizontal, Token.padCompact)
                .padding(.vertical, Token.gapRows)
            }
            .onChange(of: store.chat.count) { _, _ in scroll(proxy) }
            .onChange(of: store.isReplying) { _, _ in scroll(proxy) }
        }
    }

    private let thinkingId = "thinking"

    private func scroll(_ proxy: ScrollViewProxy) {
        withAnimation(.easeOut(duration: 0.24)) {
            if store.isReplying {
                proxy.scrollTo(thinkingId, anchor: .bottom)
            } else if let last = store.chat.last?.id {
                proxy.scrollTo(last, anchor: .bottom)
            }
        }
    }

    private var invitation: some View {
        Text("Move a stop, swap a meal, make a day quieter — say it the way you would to a person.")
            .textStyle(.detail)
            .foregroundStyle(Token.muted)
            .padding(.vertical, Token.gapRows)
    }

    private func bubble(_ turn: ChatTurn) -> some View {
        let mine = turn.role == .user
        return Text(turn.content)
            .textStyle(.detail)
            .foregroundStyle(mine ? Token.accentForeground : Token.foreground)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(
                RoundedRectangle(cornerRadius: Token.radiusMedium, style: .continuous)
                    .fill(mine ? AnyShapeStyle(Token.accent) : AnyShapeStyle(.ultraThinMaterial))
            )
            .frame(maxWidth: .infinity, alignment: mine ? .trailing : .leading)
    }

    /// A turn that did not happen.
    ///
    /// **Without this the failure is silent**, which is how a 60s client timeout looked on the
    /// simulator: the bubble vanished, the text came back, and nothing said why. The turn is
    /// dropped from `chat` deliberately, so this line is the only evidence there was one.
    private func failure(_ message: String) -> some View {
        Label(message, systemImage: "exclamationmark.circle")
            .textStyle(.caption)
            .foregroundStyle(Token.alert)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, Token.padCompact)
            .padding(.bottom, 8)
    }

    /// The model saying the edit it just made has a cost. Never collapsed into the reply.
    private var warningStrip: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(store.warnings, id: \.self) { warning in
                // The glyph carries the meaning as well as the colour does, so this still reads
                // in monochrome and to a screen reader.
                Label(warning, systemImage: "exclamationmark.triangle")
                    .textStyle(.caption)
                    .foregroundStyle(Token.muted)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, Token.padCompact)
        .padding(.bottom, 8)
    }

    private var composer: some View {
        HStack(spacing: Token.gapRows) {
            TextField("Ask for a change", text: $draft, axis: .vertical)
                .textStyle(.detail)
                .lineLimit(1...4)
                .focused($writing)
                // No `.submitLabel(.send)`: the field is `axis: .vertical`, so Return inserts a
                // newline and `onSubmit` never fires. A keyboard showing a send arrow that does
                // nothing is worse than one that does not offer it.
                .disabled(store.isReplying)

            Button {
                // Cleared here rather than on success: in flight the turn is already drawn as a
                // bubble, and leaving it in the field too showed the traveller their own sentence
                // twice for the whole minute. Put back only if the turn did not happen.
                let sending = draft
                draft = ""
                Task { if await store.send(sending) == false { draft = sending } }
            } label: {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(canSend ? Token.accent : Token.muted.opacity(0.4))
            }
            .buttonStyle(.plain)
            .disabled(!canSend)
            .accessibilityLabel("Send")
        }
        .padding(.horizontal, Token.padCompact)
        .padding(.vertical, Token.gapRows)
        .background(.ultraThinMaterial)
    }

    private var canSend: Bool {
        !store.isReplying && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}
