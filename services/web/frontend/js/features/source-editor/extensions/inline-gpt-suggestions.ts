import {
  Extension,
  StateEffect,
  StateField,
  Transaction,
  Value,
  Prec,
  EditorState,
  EditorSelection,
  TransactionSpec,
  SelectionRange,
} from '@codemirror/state'
import {
  ViewPlugin,
  ViewUpdate,
  Decoration,
  EditorView,
  DecorationSet,
  WidgetType,
  keymap,
} from '@codemirror/view'
import { OpenAI } from 'openai'

const openai = new OpenAI({
  //   process.env['OPENAI_API_KEY'], // This is the default and can be omitted
  apiKey: '<insert your API key here>',
  dangerouslyAllowBrowser: true,
})

export function debouncePromise<T extends (...args: any[]) => any>(
  fn: T,
  wait: number,
  abortValue: any = undefined
) {
  let cancel = () => {
    // do nothing
  }
  // type Awaited<T> = T extends PromiseLike<infer U> ? U : T
  type ReturnT = Awaited<ReturnType<T>>
  const wrapFunc = (...args: Parameters<T>): Promise<ReturnT> => {
    cancel()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(fn(...args)), wait)
      cancel = () => {
        clearTimeout(timer)
        if (abortValue !== undefined) {
          reject(abortValue)
        }
      }
    })
  }
  return wrapFunc
}

const callSuggestionAPI = debouncePromise(async function (text: string) {
  try {
    const completion = await openai.chat.completions.create({
      messages: [
        {
          role: 'system',
          content:
            'You are a helpful assistant that provides autocomplete suggestions to text being edited based on what is provide by the user. Only generate your suggestion inside ```latex\n{suggestion}\n```',
        },
        {
          role: 'user',
          content: '```latex\n' + text + '\n```',
        },
      ],
      store: true,
      max_tokens: 500,
      temperature: 0.7,
      model: 'gpt-4o-mini',
    })

    let suggestion = completion.choices[0].message.content

    // extract the latex suggestion
    suggestion = suggestion.match(/```latex\n([^]*)\n```/)?.[1]

    return suggestion
  } catch (error) {
    console.error('Error:', error)
    return null
  }
}, 200);

const InlineSuggestionEffect = StateEffect.define<{
  text: string | null
  doc: Text
}>()

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

      // get last 100 from the document up till the cursor
      let text = update.state.doc.sliceString(0, update.state.selection.main.head).slice(-100)

      const result = await callSuggestionAPI(text)
      
      update.view.dispatch({
        effects: InlineSuggestionEffect.of({ text: result, doc: doc }),
      })
    }
  }
)

function insertCompletionText(
  state: EditorState,
  text: string,
  from: number,
  to: number
): TransactionSpec {
  return {
    ...state.changeByRange((range: SelectionRange) => {
      if (range == state.selection.main)
        return {
          changes: { from: from, to: to, insert: text },
          range: EditorSelection.cursor(from + text.length),
        }
      const len = to - from
      if (
        !range.empty ||
        (len &&
          state.sliceDoc(range.from - len, range.from) !=
            state.sliceDoc(from, to))
      )
        return { range }
      return {
        changes: { from: range.from - len, to: range.from, insert: text },
        range: EditorSelection.cursor(range.from - len + text.length),
      }
    }),
    userEvent: 'input.complete',
  }
}

const inlineSuggestionKeymap = Prec.highest(
  keymap.of([
    {
      key: 'Tab',
      run: (view: EditorView) => {
        const suggestion = view.state.field(InlineSuggestionState)?.suggestion

        // If there is no suggestion, do nothing and let the default keymap handle it
        if (!suggestion) {
          return false
        }

        view.dispatch({
          ...insertCompletionText(
            view.state,
            suggestion,
            view.state.selection.main.head,
            view.state.selection.main.head
          ),
        })
        return true
      },
    },
  ])
)

export function inlineGPTSuggestions(): Extension {
  return [
    fetchGPTSuggestion,
    InlineSuggestionState,
    renderInlineSuggestionPlugin,
    inlineSuggestionKeymap,
  ]
}
