import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'
import { loadKnowledgeGraphCatalog } from './lib/knowledge-base/catalog'
import { SITE_TITLE } from './lib/site'

const sources = import.meta.glob('./data/graphs/*.yaml', {
  eager: true,
  import: 'default',
  query: '?raw',
}) as Record<string, string>
const graphs = loadKnowledgeGraphCatalog(sources)
document.title = SITE_TITLE

const app = mount(App, { target: document.getElementById('app')!, props: { graphs } })
export default app
