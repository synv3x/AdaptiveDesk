import { useEffect } from 'react'
import { Route, Routes } from 'react-router-dom'
import Shell from './components/layout/Shell'
import { startRuntime } from './services/runtime'
import Activity from './pages/Insights'
import Automation from './pages/Automation'
import Breaks from './pages/Breaks'
import Overview from './pages/Overview'
import Productivity from './pages/Productivity'
import Security from './pages/Security'
import Settings from './pages/Settings'
import Wearable from './pages/Wearable'

export default function App() {
  useEffect(() => startRuntime(), [])
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Overview />} />
        <Route path="security" element={<Security />} />
        <Route path="productivity" element={<Productivity />} />
        <Route path="automation" element={<Automation />} />
        <Route path="breaks" element={<Breaks />} />
        <Route path="wearable" element={<Wearable />} />
        <Route path="insights" element={<Activity />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Overview />} />
      </Route>
    </Routes>
  )
}
