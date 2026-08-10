import { notFound } from "next/navigation"
import { getTripTasks } from "@/lib/actions/trip-tasks"
import { TodoView } from "./todo-view"

export default async function TodoPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params

  try {
    // getTripTasks does the access check; nothing else on this page needs the
    // (much fatter) trip record, so we deliberately don't fetch it.
    const tasks = await getTripTasks(tripId)
    return <TodoView tripId={tripId} tasks={tasks} />
  } catch {
    notFound()
  }
}
