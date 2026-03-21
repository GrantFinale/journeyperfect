import { getAdminUsers } from "@/lib/actions/admin"
import { UsersTable } from "./users-table"

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>
}) {
  const params = await searchParams
  const page = Math.max(1, parseInt(params.page || "1", 10))
  const { users, total, pageSize } = await getAdminUsers(page)
  const totalPages = Math.ceil(total / pageSize)

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Users</h1>
      <UsersTable users={users} />
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 text-sm text-gray-600">
          <span>
            Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total} users
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <a
                href={`/admin/users?page=${page - 1}`}
                className="px-3 py-1 rounded border border-gray-300 hover:bg-gray-50"
              >
                Previous
              </a>
            )}
            {page < totalPages && (
              <a
                href={`/admin/users?page=${page + 1}`}
                className="px-3 py-1 rounded border border-gray-300 hover:bg-gray-50"
              >
                Next
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
