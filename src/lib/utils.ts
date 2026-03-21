import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { format, differenceInDays, differenceInYears } from "date-fns"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: Date | string, fmt = "MMM d, yyyy") {
  return format(new Date(date), fmt)
}

export function formatTime(time: string) {
  const [h, m] = time.split(":").map(Number)
  const period = h >= 12 ? "PM" : "AM"
  const hour = h % 12 || 12
  return `${hour}:${m.toString().padStart(2, "0")} ${period}`
}

export function tripDuration(startDate: Date | string, endDate: Date | string) {
  return differenceInDays(new Date(endDate), new Date(startDate)) + 1
}

export function formatCurrency(amount: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount)
}

export function priorityColor(priority: string) {
  const colors: Record<string, string> = {
    MUST_DO: "text-red-600 bg-red-50",
    HIGH: "text-orange-600 bg-orange-50",
    MEDIUM: "text-blue-600 bg-blue-50",
    LOW: "text-gray-600 bg-gray-50",
  }
  return colors[priority] || colors.MEDIUM
}

export function priorityLabel(priority: string) {
  const labels: Record<string, string> = {
    MUST_DO: "Must Do",
    HIGH: "High",
    MEDIUM: "Medium",
    LOW: "Low",
  }
  return labels[priority] || priority
}

export function getAge(birthDate: Date | string): number {
  return differenceInYears(new Date(), new Date(birthDate))
}

export function getAgeGroup(birthDate: Date | string): string {
  const age = getAge(birthDate)
  if (age < 2) return "infant"
  if (age <= 4) return "toddler"
  if (age <= 12) return "child"
  if (age <= 17) return "teen"
  if (age <= 64) return "adult"
  return "senior"
}

export function getAgeGroupLabel(birthDate: Date | string): string {
  const age = getAge(birthDate)
  const group = getAgeGroup(birthDate)
  const label = group.charAt(0).toUpperCase() + group.slice(1)
  if (group === "child" || group === "teen" || group === "toddler") {
    return `${label} (${age})`
  }
  return label
}

const AGE_GROUP_TAGS = ["adult", "child", "infant", "senior", "teen", "toddler"]

export function isAgeGroupTag(tag: string): boolean {
  return AGE_GROUP_TAGS.includes(tag.toLowerCase())
}

export function getCustomTags(tags: string[]): string[] {
  return tags.filter((t) => !isAgeGroupTag(t))
}
