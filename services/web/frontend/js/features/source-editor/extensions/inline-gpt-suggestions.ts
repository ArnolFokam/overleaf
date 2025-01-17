import {
  Extension,
  StateEffect,
  StateField,
  Transaction,
  Value,
} from '@codemirror/state'
import {
  ViewPlugin,
  ViewUpdate,
  Decoration,
  EditorView,
  DecorationSet,
  WidgetType,
} from '@codemirror/view'
import { OpenAI } from 'openai'

const openai = new OpenAI({
  baseURL: 'https://api.openai.com/v1/chat/completions',
  //   process.env['OPENAI_API_KEY'], // This is the default and can be omitted
  apiKey: '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',
});

const InlineSuggestionEffect = StateEffect.define<{
  text: string | null
  doc: Text
}>()

async function callSuggestionAPI(state: Value) {
  try {
    const text = state.doc.toString()
    const completion = await openai.chat.completions.create({
      messages: [
        {
          role: 'system',
          content:
            'You are a helpful assistant that provides autocomplete suggestions to latex code',
        },
        {
          role: 'user',
          content: '```latex\n' + text + '\n```',
        },
      ],
      store: true,
      max_tokens: 100,
      temperature: 0.7,
      model: 'gpt-3.5-turbo',
    })

    const suggestion = completion.choices[0].text
    return suggestion
  } catch (error) {
    console.error('Error:', error)
    return null
  }
}

// Current state of the autosuggestion
const InlineSuggestionState = StateField.define<{ suggestion: null | string }>({
  create() {
    return { suggestion: null }
  },
  update(_: Value, tr: Transaction) {
    const inlineSuggestion = tr.effects.find((e: StateEffect<any>) =>
      e.is(InlineSuggestionEffect)
    )
    if (tr.state.doc)
      if (inlineSuggestion && tr.state.doc == inlineSuggestion.value.doc) {
        return { suggestion: inlineSuggestion.value.text }
      }
    return { suggestion: null }
  },
})

class InlineSuggestionWidget extends WidgetType {
  suggestion: string
  constructor(suggestion: string) {
    super()
    this.suggestion = suggestion
  }
  toDOM() {
    const div = document.createElement('span')
    div.style.opacity = '0.4'
    div.className = 'cm-inline-suggestion'
    div.textContent = this.suggestion
    return div
  }
  get lineBreaks() {
    return this.suggestion.split('\n').length - 1
  }
}

function inlineSuggestionDecoration(view: EditorView, suffix: string) {
  const pos = view.state.selection.main.head
  const widgets = []
  const w = Decoration.widget({
    widget: new InlineSuggestionWidget(suffix),
    side: 1,
  })
  widgets.push(w.range(pos))
  return Decoration.set(widgets)
}

const renderInlineSuggestionPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor() {
      // Empty decorations
      this.decorations = Decoration.none
    }

    update(update: ViewUpdate) {
      const suggestion = update.state.field(InlineSuggestionState)?.suggestion

      if (!suggestion) {
        this.decorations = Decoration.none
        return
      }

      this.decorations = inlineSuggestionDecoration(update.view, suggestion)
    }
  },
  {
    decorations: (v: ViewPlugin) => v.decorations,
  }
)

const fetchGPTSuggestion = ViewPlugin.fromClass(
  class {
    async update(update: ViewUpdate) {
      const doc = update.state.doc
      // Only fetch if the document has changed
      if (!update.docChanged) {
        return
      }
      const result = await callSuggestionAPI(update.state)
      update.view.dispatch({
        effects: InlineSuggestionEffect.of({ text: result, doc: doc }),
      })
    }
  }
)

export function gptInlineSuggestions(): Extension {
  return [
    fetchGPTSuggestion,
    InlineSuggestionState,
    renderInlineSuggestionPlugin,
  ]
}
