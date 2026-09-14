// Shared class strings, kept out of component files so Fast Refresh keeps
// working (a file that exports both components and constants loses it).
//
// The internal app's primary button, input and label, on the partner app's
// theme tokens.
export const primaryButton =
  'w-full rounded-xl border-3 border-accent bg-accent px-5 py-3 text-lg font-black text-accent-foreground shadow-button transition-all duration-300 hover:-translate-x-[0.05em] hover:-translate-y-[0.05em] hover:shadow-button-hover hover:brightness-110 active:translate-x-[0.05em] active:translate-y-[0.05em] active:shadow-button-active disabled:cursor-not-allowed disabled:opacity-50'

export const inputClass =
  'w-full rounded-lg border border-border bg-input px-4 py-3 text-foreground placeholder:text-muted-foreground transition-all focus:border-transparent focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60'

export const labelClass = 'mb-2 block text-sm font-semibold text-foreground'
