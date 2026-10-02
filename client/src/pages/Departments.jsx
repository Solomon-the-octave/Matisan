import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Building2, Users, FolderKanban, ArrowRight } from 'lucide-react'
import Layout from '../components/Layout'
import api from '../api'

export default function Departments() {
  const [departments, setDepartments] = useState([])
  const navigate = useNavigate()

  useEffect(() => {
    api.get('/departments').then((res) => setDepartments(res.data.departments))
  }, [])

  return (
    <Layout title="Department Access Points" subtitle="Each department has its own dashboard, team and permissions">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {departments.map((d) => (
          <div key={d.id} className="surface p-5 shadow-sm transition hover:shadow-md">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 dark:bg-brand-500/15 text-brand-600 dark:text-brand-400">
              <Building2 size={20} />
            </div>
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">{d.name}</h3>
            <p className="mt-1 text-xs text-slate-400">{d.description}</p>
            <div className="mt-4 flex items-center gap-4 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1"><Users size={13} /> {d.memberCount} members</span>
              <span className="inline-flex items-center gap-1"><FolderKanban size={13} /> {d.projectCount} projects</span>
            </div>
            <button
              onClick={() => navigate(`/users?department=${d.id}`)}
              className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-brand-600 dark:text-brand-400 hover:underline"
            >
              Open access point <ArrowRight size={13} />
            </button>
          </div>
        ))}
      </div>
    </Layout>
  )
}
