import { Routes, Route, Navigate } from 'react-router-dom'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Departments from './pages/Departments'
import Users from './pages/Users'
import Projects from './pages/Projects'
import Tasks from './pages/Tasks'
import Attendance from './pages/Attendance'
import FieldAttendance from './pages/FieldAttendance'
import Reports from './pages/Reports'
import Profile from './pages/Profile'
import ProtectedRoute from './components/ProtectedRoute'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/departments" element={<ProtectedRoute roles={['admin']}><Departments /></ProtectedRoute>} />
      <Route path="/users" element={<ProtectedRoute roles={['admin', 'supervisor']}><Users /></ProtectedRoute>} />
      <Route path="/projects" element={<ProtectedRoute><Projects /></ProtectedRoute>} />
      <Route path="/tasks" element={<ProtectedRoute><Tasks /></ProtectedRoute>} />
      <Route path="/attendance" element={<ProtectedRoute><Attendance /></ProtectedRoute>} />
      <Route path="/field-attendance" element={<ProtectedRoute><FieldAttendance /></ProtectedRoute>} />
      <Route path="/reports" element={<ProtectedRoute roles={['admin', 'supervisor']}><Reports /></ProtectedRoute>} />
      <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}
