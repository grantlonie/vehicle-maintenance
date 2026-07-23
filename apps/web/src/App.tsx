import { Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { getToken } from './lib/api'
import { HomePage } from './pages/HomePage'
import { LogPage } from './pages/LogPage'
import { LoginPage } from './pages/LoginPage'
import { SettingsPage } from './pages/SettingsPage'
import { TemplatesPage } from './pages/TemplatesPage'
import { VehiclePage } from './pages/VehiclePage'

export function App() {
  const authed = Boolean(getToken())

  if (!authed) {
    return <LoginPage />
  }

  return (
    <Layout>
      <Routes>
        <Route element={<HomePage />} path="/" />
        <Route element={<VehiclePage />} path="/vehicles/:id" />
        <Route element={<LogPage />} path="/vehicles/:id/log" />
        <Route element={<TemplatesPage />} path="/templates" />
        <Route element={<SettingsPage />} path="/settings" />
        <Route element={<Navigate replace to="/" />} path="*" />
      </Routes>
    </Layout>
  )
}
