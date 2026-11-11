import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css'
import '@fontsource/barlow-semi-condensed/500.css'
import '@fontsource/barlow-semi-condensed/600.css'
import '@fontsource/barlow-semi-condensed/700.css'
import App from './App'
import './index.css'
import { readShared } from './share'
import { initAnalytics, track } from './analytics'

// a shared link (`?r=…`) opens its calculation
// analytics starts after readShared has taken `?r=` out of the address
void readShared().then((shared) => {
  initAnalytics()
  if (shared) track('shared_link_open', { screen: shared.mode })
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App shared={shared} />
    </StrictMode>,
  )
})
