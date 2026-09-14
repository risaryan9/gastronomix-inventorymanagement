// Where to go after signing in. Only a path on this site — never "//other.site"
// or "https://…", which would turn the sign-in page into a redirect for phishing.
export function safeNextPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return '/'
  }
  return value
}
