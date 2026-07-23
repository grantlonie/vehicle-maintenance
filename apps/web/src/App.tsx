import { Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { ScrollToTop } from './components/ScrollToTop'
import { getToken } from './lib/api'
import { HomePage } from './pages/HomePage'
import { LogPage } from './pages/LogPage'
import { LoginPage } from './pages/LoginPage'
import { SettingsPage } from './pages/SettingsPage'
import { VehicleHistoryPage } from './pages/VehicleHistoryPage'
import { VehiclePage } from './pages/VehiclePage'
import { VehicleSchedulesPage } from './pages/VehicleSchedulesPage'

export function App() {
  const authed = Boolean(getToken())

  if (!authed) {
    return <LoginPage />
  }

  return (
    <Layout>
      <ScrollToTop />
      <Routes>
        <Route element={<HomePage />} path="/" />
        <Route element={<VehiclePage />} path="/vehicles/:id" />
        <Route element={<VehicleSchedulesPage />} path="/vehicles/:id/schedules" />
        <Route element={<VehicleHistoryPage />} path="/vehicles/:id/history" />
        <Route element={<LogPage />} path="/vehicles/:id/log" />
        <Route element={<SettingsPage />} path="/settings" />
        <Route element={<Navigate replace to="/" />} path="*" />
      </Routes>
    </Layout>
  )
}
