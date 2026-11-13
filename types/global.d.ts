
// The TypeScript lib must be referenced; otherwise $message has no type definition on Window


interface Window {
  $loading: any
  $message: any
  $dialog: any
  // Locale / translation
  $t: any
  $vue: any
  // Keyboard key state
  $KeyboardActive?: { [T: string]: boolean }
  onKeySpacePressHold?: Function

  // Storage object for editing JSON
  opener: any
}

declare type Recordable<T = any> = Record<string, T>


