// Node built-ins the browser bundle never reaches at runtime.
export const readFile = () => { throw new Error('no fs in the browser') }
export const createRequire = () => ({ resolve: () => { throw new Error('no require in the browser') } })
export default {}
