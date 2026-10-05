// Bundle entry: window.CodeRed.mount(element, { assets }) for embedding pages.
import { mount } from './player.ts'
export { mount }
declare global { interface Window { CodeRed?: { mount: typeof mount } } }
window.CodeRed = { mount }
