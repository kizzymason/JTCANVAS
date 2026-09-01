import React from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import MainLayout from './components/MainLayout'
import AccountList from './pages/AccountList'
import RegisterControl from './pages/RegisterControl'
import ResultsTable from './pages/ResultsTable'
import ExportData from './pages/ExportData'
import SettingsPage from './pages/Settings'
import Diagnostics from './pages/Diagnostics'

const App: React.FC = () => (
  <Routes>
    <Route path="/" element={<MainLayout />}>
      <Route index element={<Navigate to="/accounts" replace />} />
      <Route path="accounts" element={<AccountList />} />
      <Route path="register" element={<RegisterControl />} />
      <Route path="results" element={<ResultsTable />} />
      <Route path="export" element={<ExportData />} />
      <Route path="settings" element={<SettingsPage />} />
      <Route path="diagnostics" element={<Diagnostics />} />
      <Route path="*" element={<Navigate to="/accounts" replace />} />
    </Route>
  </Routes>
)

export default App
