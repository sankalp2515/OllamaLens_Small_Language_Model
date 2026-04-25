import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Sidebar } from './components/ui'
import Chat      from './pages/Chat'
import Benchmark from './pages/Benchmark'
import Compare   from './pages/Compare'
import Report    from './pages/Report'
import './index.css'

export default function App() {
  return (
    <BrowserRouter>
      <div style={{ display: 'flex', minHeight: '100vh' }}>
        <Sidebar />
        <div style={{ marginLeft: 220, flex: 1, display: 'flex', flexDirection: 'column' }}>
          <Routes>
            <Route path="/"          element={<Chat />} />
            <Route path="/benchmark" element={<Benchmark />} />
            <Route path="/compare"   element={<Compare />} />
            <Route path="/report"    element={<Report />} />
          </Routes>
        </div>
      </div>
    </BrowserRouter>
  )
}
