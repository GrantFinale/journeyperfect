"use client"

import { useTransition } from "react"
import { toggleUserAdmin, updateUserPlan } from "@/lib/actions/admin"

type User = {
  id: string
  name: string | null
  email: string
  image: string | null
  plan: string
  isAdmin: boolean
  createdAt: Date
  _count: { trips: number }
}

export function UsersTable({ users }: { users: User[] }) {
  const [isPending, startTransition] = useTransition()

  function handleToggleAdmin(userId: string) {
    startTransition(async () => {
      await toggleUserAdmin(userId)
    })
  }

  function handlePlanChange(userId: string, plan: string) {
    startTransition(async () => {
      await updateUserPlan(userId, plan)
    })
  }

  const planColors: Record<string, string> = {
    FREE: "bg-gray-100 text-gray-700 border-gray-300",
    PERSONAL: "bg-blue-50 text-blue-700 border-blue-300",
    FAMILY: "bg-green-50 text-green-700 border-green-300",
    PRO: "bg-purple-50 text-purple-700 border-purple-300",
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            <th className="text-left px-4 py-3 font-medium text-gray-700">User</th>
            <th className="text-left px-4 py-3 font-medium text-gray-700">Email</th>
            <th className="text-left px-4 py-3 font-medium text-gray-700">Plan</th>
            <th className="text-left px-4 py-3 font-medium text-gray-700">Trips</th>
            <th className="text-left px-4 py-3 font-medium text-gray-700">Role</th>
            <th className="text-right px-4 py-3 font-medium text-gray-700">Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id} className="border-b border-gray-100 last:border-0">
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  {user.image ? (
                    <img src={user.image} alt="" className="w-7 h-7 rounded-full" />
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center text-xs font-medium text-gray-600">
                      {(user.name || user.email)[0]?.toUpperCase()}
                    </div>
                  )}
                  <span className="font-medium text-gray-900">{user.name || "—"}</span>
                </div>
              </td>
              <td className="px-4 py-3 text-gray-600">{user.email}</td>
              <td className="px-4 py-3">
                <select
                  value={user.plan}
                  onChange={(e) => handlePlanChange(user.id, e.target.value)}
                  disabled={isPending}
                  className={`px-2 py-0.5 rounded text-xs font-medium border cursor-pointer disabled:opacity-50 ${planColors[user.plan] || "bg-gray-100 text-gray-700 border-gray-300"}`}
                >
                  <option value="FREE">FREE</option>
                  <option value="PERSONAL">PERSONAL</option>
                  <option value="FAMILY">FAMILY</option>
                  <option value="PRO">PRO</option>
                </select>
              </td>
              <td className="px-4 py-3 text-gray-600">{user._count.trips}</td>
              <td className="px-4 py-3">
                {user.isAdmin && (
                  <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">
                    Admin
                  </span>
                )}
              </td>
              <td className="px-4 py-3 text-right">
                <button
                  onClick={() => handleToggleAdmin(user.id)}
                  disabled={isPending}
                  className="text-xs text-indigo-600 hover:text-indigo-800 disabled:opacity-50"
                >
                  {user.isAdmin ? "Remove Admin" : "Make Admin"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {users.length === 0 && (
        <p className="text-center py-8 text-gray-500 text-sm">No users found</p>
      )}
    </div>
  )
}
