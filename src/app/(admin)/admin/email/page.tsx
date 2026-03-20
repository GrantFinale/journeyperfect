export default function EmailSetupPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">
        Email Forwarding Setup
      </h1>

      {/* Status */}
      <div className="bg-white rounded-lg border p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-3">
          DNS Configuration
        </h2>
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
            <span className="font-mono text-gray-700">
              MX inbound.journeyperfect.com &rarr; mx.sendgrid.net (priority
              10)
            </span>
          </div>
          <p className="text-gray-500 ml-4">
            Added via DigitalOcean DNS. TTL 300s.
          </p>
        </div>
      </div>

      {/* SendGrid Setup */}
      <div className="bg-white rounded-lg border p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-3">
          SendGrid Inbound Parse Setup
        </h2>
        <p className="text-sm text-gray-600 mb-4">
          Complete these steps in the SendGrid dashboard to activate email
          forwarding.
        </p>
        <ol className="list-decimal list-inside space-y-3 text-sm text-gray-700">
          <li>
            Sign in to{" "}
            <a
              href="https://app.sendgrid.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 underline"
            >
              app.sendgrid.com
            </a>{" "}
            (free tier supports Inbound Parse).
          </li>
          <li>
            Go to{" "}
            <strong>Settings &rarr; Inbound Parse &rarr; Add Host & URL</strong>
            .
          </li>
          <li>
            Set the <strong>receiving domain</strong> to:
            <code className="ml-2 px-2 py-0.5 bg-gray-100 rounded text-xs font-mono">
              inbound.journeyperfect.com
            </code>
          </li>
          <li>
            Set the <strong>destination URL</strong> to:
            <code className="ml-2 px-2 py-0.5 bg-gray-100 rounded text-xs font-mono">
              https://journeyperfect.com/api/inbound-email
            </code>
          </li>
          <li>
            Check{" "}
            <strong>&quot;POST the raw, full MIME message&quot;</strong> (optional
            &mdash; the current handler uses form fields, not raw MIME; leave
            unchecked unless you want the raw payload).
          </li>
          <li>
            Click <strong>Add</strong>.
          </li>
        </ol>
      </div>

      {/* How it works */}
      <div className="bg-white rounded-lg border p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-3">
          How It Works
        </h2>
        <div className="text-sm text-gray-700 space-y-2">
          <p>
            Users forward confirmation emails to their personal address:
          </p>
          <code className="block px-3 py-2 bg-gray-100 rounded text-xs font-mono">
            trips+&#123;userId&#125;@inbound.journeyperfect.com
          </code>
          <p>
            The <code className="text-xs font-mono">+&#123;userId&#125;</code>{" "}
            portion identifies the user. The webhook parses the email to detect
            flights and hotel bookings, then saves them to the user&apos;s next
            upcoming trip.
          </p>
        </div>
      </div>

      {/* Webhook details */}
      <div className="bg-white rounded-lg border p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-3">
          Webhook Details
        </h2>
        <table className="text-sm w-full">
          <tbody className="divide-y">
            <tr>
              <td className="py-2 pr-4 font-medium text-gray-600 w-40">
                Endpoint
              </td>
              <td className="py-2 font-mono text-gray-800">
                POST /api/inbound-email
              </td>
            </tr>
            <tr>
              <td className="py-2 pr-4 font-medium text-gray-600">Format</td>
              <td className="py-2 font-mono text-gray-800">
                multipart/form-data (SendGrid default)
              </td>
            </tr>
            <tr>
              <td className="py-2 pr-4 font-medium text-gray-600">
                Fields used
              </td>
              <td className="py-2 font-mono text-gray-800">
                to, subject, text, html
              </td>
            </tr>
            <tr>
              <td className="py-2 pr-4 font-medium text-gray-600">
                Auth
              </td>
              <td className="py-2 text-gray-800">
                None (public webhook). Consider adding a shared secret via
                SendGrid&apos;s basic auth or checking the User-Agent header.
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Testing */}
      <div className="bg-white rounded-lg border p-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-3">
          Testing
        </h2>
        <ol className="list-decimal list-inside space-y-2 text-sm text-gray-700">
          <li>
            Verify MX record:{" "}
            <code className="px-2 py-0.5 bg-gray-100 rounded text-xs font-mono">
              dig MX inbound.journeyperfect.com
            </code>
          </li>
          <li>
            Send a test email to{" "}
            <code className="px-2 py-0.5 bg-gray-100 rounded text-xs font-mono">
              trips+test@inbound.journeyperfect.com
            </code>{" "}
            (will 404 since &quot;test&quot; is not a real userId &mdash; check
            server logs for the attempt).
          </li>
          <li>
            Use a real userId from the database and forward an airline
            confirmation email. Check the trip in the dashboard for new flights
            or hotels.
          </li>
          <li>
            Use{" "}
            <code className="px-2 py-0.5 bg-gray-100 rounded text-xs font-mono">
              curl -X POST https://journeyperfect.com/api/inbound-email -F
              &quot;to=trips+USER_ID@inbound.journeyperfect.com&quot; -F
              &quot;subject=Booking Confirmation&quot; -F &quot;text=Your flight
              AA123 departs JFK...&quot;
            </code>{" "}
            to simulate a webhook call directly.
          </li>
        </ol>
      </div>
    </div>
  )
}
