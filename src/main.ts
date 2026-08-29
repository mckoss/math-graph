import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'
import knowledgeBaseSource from './data/knowledge-base.yaml?raw'
import { loadKnowledgeBase } from './lib/knowledge-base/load'

const graph = loadKnowledgeBase(knowledgeBaseSource)

const app = mount(App, { target: document.getElementById('app')!, props: { graph } })
export default app
