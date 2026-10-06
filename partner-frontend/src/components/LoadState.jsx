import Alert from './Alert.jsx'

/*
 * What a screen shows while its data is on the way or failed to arrive, for
 * screens built on useApi. Renders nothing once the data is there.
 *
 *   <LoadState loading={loading} error={error} reload={reload} blocks={['h-32', 'h-32']} />
 */
export default function LoadState({ loading, error, reload, blocks = ['h-28', 'h-28', 'h-28'] }) {
  if (error) {
    return (
      <div className="mt-6">
        <Alert>
          {error.message}{' '}
          <button type="button" onClick={reload} className="font-semibold text-accent-text hover:underline">Try again</button>
        </Alert>
      </div>
    )
  }
  if (!loading) return null
  return (
    <div className="mt-6 space-y-3" aria-busy="true">
      {blocks.map((height, i) => (
        <div key={i} className={`${height} animate-pulse rounded-2xl border-2 border-border bg-card/60`} />
      ))}
    </div>
  )
}
