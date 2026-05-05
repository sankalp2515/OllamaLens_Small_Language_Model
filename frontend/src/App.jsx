import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AppProvider } from './context/AppContext'
import { Sidebar } from './components/Sidebar'
import Chat      from './pages/Chat'
import Benchmark from './pages/Benchmark'
import Compare   from './pages/Compare'
import Report    from './pages/Report'
import './index.css'

export default function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--page)' }}>
          <Sidebar />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <Routes>
              <Route path="/"          element={<Chat />} />
              <Route path="/benchmark" element={<Benchmark />} />
              <Route path="/compare"   element={<Compare />} />
              <Route path="/report"    element={<Report />} />
            </Routes>
          </div>
        </div>
      </BrowserRouter>
    </AppProvider>
  )
}