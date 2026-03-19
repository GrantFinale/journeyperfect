import { getAdminUsers } from "@/lib/actions/admin"
import { UsersTable } from "./users-table"

export default async function UsersPage() {
  const users = await getAdminUsers()

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Users</h1>
      <UsersTable users={users} />
    </div>
  )
}
