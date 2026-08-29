import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'
import { parseCurriculum } from './lib/curriculum/parser'
import curriculumSource from './data/curriculum.yaml?raw'

const { graph, errors } = parseCurriculum(curriculumSource)
if (errors.length > 0) console.error('curriculum.yaml parse errors:', errors)

const app = mount(App, { target: document.getElementById('app')!, props: { graph } })
export default app
