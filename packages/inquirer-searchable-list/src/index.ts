import chalk from 'chalk'
import figures from 'figures'
import * as fuzzy from 'fuzzy'
import { filter, map, takeUntil } from 'rxjs'

import Base from 'inquirer/lib/prompts/base'
import Observe from 'inquirer/lib/utils/events'
import Paginator from 'inquirer/lib/utils/paginator'

import { IGNORE_KEY_SET } from './constants'

import type { Answers, Question } from 'inquirer'
import type { Interface as ReadLineInterface } from 'readline'

type QuestionItem = Question<Answers> & {
  id: number
  pageSize?: number
  value?: unknown
}

// renderer is used to _display_ a row
type Renderer = (item: QuestionItem, isSelected: boolean) => string

// filterer is used to _fuzzy search_ a row
// it's separate from renderer so you can search for non-visible text!
type Filterer = (item: QuestionItem, query: string) => boolean

function defaultFilterRow(choice: QuestionItem, query: string) {
  if (!choice.name) return false

  return fuzzy.test(query, choice.name)
}

function defaultRenderRow(choice: QuestionItem, isSelected: boolean) {
  if (isSelected) return `${chalk.cyan(figures.pointer)}${chalk.cyan(choice?.name || '')}`

  return ` ${choice.name}`
}

function renderChoices(renderRow: Renderer, choices: QuestionItem[], pointer: number) {
  let output = ''

  choices.forEach(function (choice, i) {
    output += renderRow(choice, i === pointer)
    output += '\n'
  })

  return output.replace(/\n$/, '')
}

class SearchableListPrompt<T extends QuestionItem = QuestionItem> extends Base<T> {
  private pointer = 0
  private selected: string | undefined = ''
  private done!: (state: unknown) => void
  private list: QuestionItem[] = []
  private filterList: QuestionItem[] = []
  private paginator: Paginator
  private renderRow: Renderer = defaultRenderRow
  private filterRow: Filterer = defaultFilterRow

  constructor(question: T, readLine: ReadLineInterface, answers: Answers) {
    super(question, readLine, answers)

    const { choices } = this.opt

    if (!choices) {
      this.throwParamError('choices')
    }
    const realChoices = choices.realChoices.map((item, id) => ({ ...item, id }))

    this.filterList = realChoices
    this.list = realChoices
    this.paginator = new Paginator(this.screen)
  }

  render(error?: string) {
    // Render question
    let message = this.getQuestion()
    let bottomContent = ''
    const tip = chalk.dim('(Press <enter> to submit)')

    // Render choices or answer depending on the state
    if (this.status === 'answered') {
      message += chalk.cyan(this.selected ? this.selected : '')
    } else {
      message += `${tip} ${this.rl.line}`
      const choicesStr = renderChoices(this.renderRow, this.filterList, this.pointer)
      bottomContent = this.paginator.paginate(choicesStr, this.pointer, this.opt.pageSize)
    }

    if (error) {
      bottomContent = chalk.red('>> ') + error
    }

    this.screen.render(message, bottomContent)
  }

  filterChoices() {
    this.filterList = this.list.filter((choice) => this.filterRow(choice, this.rl.line))
  }

  onDownKey() {
    const len = this.filterList.length
    this.pointer = this.pointer < len - 1 ? this.pointer + 1 : 0
    this.render()
  }

  onUpKey() {
    const len = this.filterList.length
    this.pointer = this.pointer > 0 ? this.pointer - 1 : len - 1
    this.render()
  }

  onAllKey() {
    this.render()
  }

  onEnd(state: any) {
    this.status = 'answered'

    if (this.getCurrentItemName()) {
      this.selected = this.getCurrentItemName()
    }
    // Rerender prompt (and clean subline error)
    this.render()

    this.screen.done()
    this.done(state.value)
  }

  onError(state: any) {
    this.render(state.isValid)
  }

  onKeyPress() {
    this.pointer = 0
    this.filterChoices()
    this.render()
  }

  getCurrentItem() {
    if (this.filterList.length) {
      return this.filterList[this.pointer]
    }

    return this.list[this.pointer]
  }

  getCurrentItemValue() {
    return this.getCurrentItem().value
  }

  getCurrentItemName() {
    return this.getCurrentItem().name
  }

  _run(callback: (callback: any) => void) {
    this.done = callback

    const events = Observe(this.rl)
    const validation = this.handleSubmitEvents(
      events.line.pipe(map(this.getCurrentItemValue.bind(this)))
    )

    validation.success.forEach(this.onEnd.bind(this))
    validation.error.forEach(this.onError.bind(this))

    events.normalizedUpKey.pipe(takeUntil(events.line)).forEach(this.onUpKey.bind(this))
    events.normalizedDownKey.pipe(takeUntil(events.line)).forEach(this.onDownKey.bind(this))
    events.aKey.pipe(takeUntil(validation.success)).forEach(this.onAllKey.bind(this))
    events.keypress
      .pipe(
        filter(({ key: { ctrl, name } }) => {
          const isIgnoreKey = !!name && IGNORE_KEY_SET.has(name)

          return !ctrl && !isIgnoreKey
        }),
        takeUntil(validation.success)
      )
      .forEach(this.onKeyPress.bind(this))

    this.render()
    return this
  }
}

export default SearchableListPrompt
