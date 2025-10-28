import { useState, useMemo, useEffect } from 'react'
import { PaymentsApi } from '../../../services/paymentsApi'
import { BarChart3, AlertTriangle, CheckSquare, Clock, Wallet } from 'lucide-react'
import {
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  LineChart,
  Line
} from 'recharts'
import { KPICard, CustomDropdown } from '../../../components'
import { CSVPDFExportButton } from '../../../components/ui/export-button'
import { Pagination } from '../../../components/ui/Pagination'

type PaymentAgingRecord = {
  vendor: string
  outstandingAmount: number
  avgDaysPending: number
  oldestInvoiceDate: string
  oldestInvoiceDays: number
}

type ComplianceRecord = {
  vendor: string
  totalInvoices: number
  compliantPercentage: number
  issuesFound: number
}

type SLABreachRecord = {
  slaType: string
  breachCount: number
  avgDelayDays: number
}

type TimeRange = 'weekly' | 'monthly' | 'yearly'

// Live data state (replaces mock)
const computeDaysOld = (isoDate: string | null): number => {
  if (!isoDate) return 0
  const d = new Date(isoDate)
  const ms = Date.now() - d.getTime()
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)))
}

// Live compliance data will be loaded via API




function AccountsReports() {
  // --- Export helpers ---
  const downloadFile = (content: string, filename: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const toCSV = (rows: Array<Record<string, unknown>>, headerOrder?: string[]) => {
    if (!rows || rows.length === 0) return ''
    const headers = headerOrder && headerOrder.length > 0
      ? headerOrder
      : Array.from(new Set(rows.flatMap((r) => Object.keys(r))))
    const escapeCSV = (val: unknown) => {
      const s = val === undefined || val === null ? '' : String(val)
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? '"' + s.replace(/"/g, '""') + '"'
        : s
    }
    const lines = [headers.join(',')]
    for (const row of rows) {
      lines.push(
        headers
          .map((h) => escapeCSV((row as Record<string, unknown>)[h]))
          .join(',')
      )
    }
    return lines.join('\n')
  }

  // Payment Aging export
  const handleAgingExportCSV = () => {
    const rows = filteredPaymentAging.map(r => ({
      vendor: r.vendor,
      outstandingAmount: r.outstandingAmount,
      avgDaysPending: r.avgDaysPending,
      oldestInvoiceDate: r.oldestInvoiceDate,
      oldestInvoiceDays: r.oldestInvoiceDays
    }))
    const csv = toCSV(rows, ['vendor', 'outstandingAmount', 'avgDaysPending', 'oldestInvoiceDate', 'oldestInvoiceDays'])
    downloadFile(csv, `payment_aging_${new Date().toISOString().slice(0,10)}.csv`, 'text/csv;charset=utf-8;')
  }

  const handleAgingExportPDF = () => {
    const rows = filteredPaymentAging
    const html = `
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Vendor Payment Aging</title>
          <style>
            body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; padding: 16px; color:#111827 }
            h1 { font-size:18px; margin:0 0 12px }
            table { width:100%; border-collapse:collapse; font-size:12px; background:#fff }
            th, td { text-align:left; padding:8px; border-bottom:1px solid #e5e7eb }
            thead { background:#f9fafb }
          </style>
        </head>
        <body>
          <h1>Vendor Payment Aging</h1>
          <table>
            <thead>
              <tr>
                <th>Vendor</th>
                <th>Outstanding Amount</th>
                <th>Avg Days Pending</th>
                <th>Oldest Invoice</th>
                <th>Oldest Days</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(r => `<tr>
                <td>${r.vendor}</td>
                <td>₹${r.outstandingAmount.toLocaleString('en-IN')}</td>
                <td>${r.avgDaysPending}</td>
                <td>${r.oldestInvoiceDate}</td>
                <td>${r.oldestInvoiceDays}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </body>
      </html>
    `
    const iframe = document.createElement('iframe')
    iframe.style.position = 'fixed'
    iframe.style.right = '0'
    iframe.style.bottom = '0'
    iframe.style.width = '0'
    iframe.style.height = '0'
    iframe.style.border = '0'
    document.body.appendChild(iframe)
    const doc = iframe.contentWindow?.document
    if (!doc) { document.body.removeChild(iframe); return }
    doc.open(); doc.write(html); doc.close()
    const cleanup = () => { if (iframe.parentNode) document.body.removeChild(iframe) }
    iframe.contentWindow?.addEventListener('afterprint', cleanup, { once: true })
    setTimeout(() => { iframe.contentWindow?.focus(); iframe.contentWindow?.print(); setTimeout(cleanup, 1500) }, 250)
  }
  const [timeRange, setTimeRange] = useState<TimeRange>('weekly')
  // Loading state for tables (shows Orders-style loading card inside table areas)
  const [loading, setLoading] = useState(false)
  
  // Payment Aging Filters
  const [agingVendorFilter, setAgingVendorFilter] = useState('')
  const [agingStatusFilter, setAgingStatusFilter] = useState<string>('all')
  const [agingData, setAgingData] = useState<PaymentAgingRecord[]>([])
  
  // Compliance Filters
  const [complianceVendorFilter, setComplianceVendorFilter] = useState('')
  const [complianceFilter, setComplianceFilter] = useState<string>('all')
  const [complianceData, setComplianceData] = useState<ComplianceRecord[]>([])
  const [overallCompliance, setOverallCompliance] = useState<number>(0)
  
  // SLA Filters
  const [slaTypeFilter, setSlaTypeFilter] = useState<string>('all')
  const [slaBreachSeverity, setSlaBreachSeverity] = useState<string>('all')
  const [slaDelaySeverity, setSlaDelaySeverity] = useState<string>('all')
  const [slaBreachData, setSlaBreachData] = useState<SLABreachRecord[]>([])
  const [totalSlaBreaches, setTotalSlaBreaches] = useState<number>(0)
  const [avgDelayAcrossAll, setAvgDelayAcrossAll] = useState<number>(0)

  // Pagination for each table
  const [agingCurrentPage, setAgingCurrentPage] = useState(1)
  const [complianceCurrentPage, setComplianceCurrentPage] = useState(1)
  const [slaCurrentPage, setSlaCurrentPage] = useState(1)
  const itemsPerPage = 10

  // Fetch aging data
  useEffect(() => {
    let mounted = true
    setLoading(true)
    PaymentsApi.aging()
      .then((resp) => {
        if (!mounted) return
        const items = (resp?.data || []).map((r) => {
          const oldestDays = computeDaysOld(r.oldestInvoiceDate)
          const record: PaymentAgingRecord = {
            vendor: r.vendorName,
            outstandingAmount: r.outstandingAmount,
            avgDaysPending: r.avgPendingDays,
            oldestInvoiceDate: r.oldestInvoiceDate || '',
            oldestInvoiceDays: oldestDays,
          }
          return record
        })
        setAgingData(items)
      })
      .finally(() => {
        if (mounted) setLoading(false)
      })
    return () => { mounted = false }
  }, [])

  // Fetch compliance data
  useEffect(() => {
    let mounted = true
    setLoading(true)
    PaymentsApi.compliance()
      .then((resp) => {
        if (!mounted) return
        const rows = (resp?.data?.vendors || []).map(v => ({
          vendor: v.vendor,
          totalInvoices: v.totalInvoices,
          compliantPercentage: v.compliantPercentage,
          issuesFound: v.issuesFound
        }))
        setComplianceData(rows)
        setOverallCompliance(resp?.data?.overallComplianceRate || 0)
      })
      .finally(() => {
        if (mounted) setLoading(false)
      })
    return () => { mounted = false }
  }, [])

  // Fetch SLA breaches data
  useEffect(() => {
    let mounted = true
    setLoading(true)
    PaymentsApi.slaBreaches()
      .then((resp) => {
        if (!mounted) return
        const items = (resp?.data?.items || []).map(item => ({
          slaType: item.slaType,
          breachCount: item.breachCount,
          avgDelayDays: item.avgDelayDays
        }))
        setSlaBreachData(items)
        setTotalSlaBreaches(resp?.data?.totalBreaches || 0)
        setAvgDelayAcrossAll(resp?.data?.avgDelayAcrossAll || 0)
      })
      .finally(() => {
        if (mounted) setLoading(false)
      })
    return () => { mounted = false }
  }, [])

  // Calculate summary metrics
  const [paymentsReleased, setPaymentsReleased] = useState(0)
  const [pendingPayments, setPendingPayments] = useState(0)

  useEffect(() => {
    let mounted = true
    PaymentsApi.summary(timeRange)
      .then((resp) => {
        if (!mounted) return
        setPaymentsReleased(resp?.data?.released || 0)
        setPendingPayments(resp?.data?.pending || 0)
      })
      .catch(() => {})
    return () => { mounted = false }
  }, [timeRange])

  const summaryMetrics = useMemo(() => {
    const totalOutstanding = agingData.reduce((sum, item) => sum + item.outstandingAmount, 0)
    const avgCompliance = overallCompliance
    const totalBreaches = totalSlaBreaches
    return {
      totalOutstanding,
      avgCompliance,
      totalBreaches,
      paymentsReleased,
      pendingPayments,
    }
  }, [agingData, overallCompliance, totalSlaBreaches, paymentsReleased, pendingPayments])

  // Filter Payment Aging data
  const filteredPaymentAging = useMemo(() => {
    let filtered = agingData
    
    // Vendor filter
    if (agingVendorFilter) {
      filtered = filtered.filter(item => item.vendor.toLowerCase().includes(agingVendorFilter.toLowerCase()))
    }
    
    // Status filter
    if (agingStatusFilter !== 'all') {
      filtered = filtered.filter(item => {
        if (agingStatusFilter === 'overdue') return item.avgDaysPending > 30
        if (agingStatusFilter === 'warning') return item.avgDaysPending > 15 && item.avgDaysPending <= 30
        if (agingStatusFilter === 'good') return item.avgDaysPending <= 15
        return true
      })
    }
    
    return filtered
  }, [agingVendorFilter, agingStatusFilter, agingData])

  // Filter Compliance data
  const filteredCompliance = useMemo(() => {
    let filtered = complianceData
    
    // Vendor filter
    if (complianceVendorFilter) {
      filtered = filtered.filter(item => item.vendor.toLowerCase().includes(complianceVendorFilter.toLowerCase()))
    }
    
    // Compliance level filter
    if (complianceFilter !== 'all') {
      filtered = filtered.filter(item => {
        if (complianceFilter === 'high') return item.compliantPercentage >= 95
        if (complianceFilter === 'medium') return item.compliantPercentage >= 85 && item.compliantPercentage < 95
        if (complianceFilter === 'low') return item.compliantPercentage < 85
        return true
      })
    }
    
    return filtered
  }, [complianceVendorFilter, complianceFilter, complianceData])

  // Filter SLA data
  const filteredSLABreaches = useMemo(() => {
    let filtered = slaBreachData
    
    // SLA Type filter
    if (slaTypeFilter !== 'all') {
      filtered = filtered.filter(item => item.slaType === slaTypeFilter)
    }
    
    // Breach Severity filter (based on breach count)
    if (slaBreachSeverity !== 'all') {
      filtered = filtered.filter(item => {
        if (slaBreachSeverity === 'high') return item.breachCount >= 12
        if (slaBreachSeverity === 'medium') return item.breachCount >= 8 && item.breachCount < 12
        if (slaBreachSeverity === 'low') return item.breachCount < 8
        return true
      })
    }
    
    // Delay Severity filter (based on avg delay days)
    if (slaDelaySeverity !== 'all') {
      filtered = filtered.filter(item => {
        if (slaDelaySeverity === 'critical') return item.avgDelayDays > 5
        if (slaDelaySeverity === 'moderate') return item.avgDelayDays > 3 && item.avgDelayDays <= 5
        if (slaDelaySeverity === 'minor') return item.avgDelayDays <= 3
        return true
      })
    }
    
    return filtered
  }, [slaTypeFilter, slaBreachSeverity, slaDelaySeverity, slaBreachData])

  // Pagination calculations for Payment Aging
  const agingTotalPages = Math.ceil(filteredPaymentAging.length / itemsPerPage)
  const agingStartIndex = (agingCurrentPage - 1) * itemsPerPage
  const agingEndIndex = Math.min(agingStartIndex + itemsPerPage, filteredPaymentAging.length)
  const paginatedPaymentAging = filteredPaymentAging.slice(agingStartIndex, agingEndIndex)

  // Pagination calculations for Compliance
  const complianceTotalPages = Math.ceil(filteredCompliance.length / itemsPerPage)
  const complianceStartIndex = (complianceCurrentPage - 1) * itemsPerPage
  const complianceEndIndex = Math.min(complianceStartIndex + itemsPerPage, filteredCompliance.length)
  const paginatedCompliance = filteredCompliance.slice(complianceStartIndex, complianceEndIndex)

  // Pagination calculations for SLA
  const slaTotalPages = Math.ceil(filteredSLABreaches.length / itemsPerPage)
  const slaStartIndex = (slaCurrentPage - 1) * itemsPerPage
  const slaEndIndex = Math.min(slaStartIndex + itemsPerPage, filteredSLABreaches.length)
  const paginatedSLABreaches = filteredSLABreaches.slice(slaStartIndex, slaEndIndex)

  // Reset to page 1 when filters change
  useEffect(() => {
    setAgingCurrentPage(1)
  }, [agingVendorFilter, agingStatusFilter])

  useEffect(() => {
    setComplianceCurrentPage(1)
  }, [complianceVendorFilter, complianceFilter])

  useEffect(() => {
    setSlaCurrentPage(1)
  }, [slaTypeFilter, slaBreachSeverity, slaDelaySeverity])

  const [paymentChartData, setPaymentChartData] = useState<Array<{ period: string; released: number; pending: number }>>([])

  // Fetch trends whenever timeRange changes
  useEffect(() => {
    let mounted = true
    setLoading(true)
    PaymentsApi.trends(timeRange)
      .then((resp) => {
        if (!mounted) return
        setPaymentChartData(resp?.data || [])
      })
      .finally(() => {
        if (mounted) setLoading(false)
      })
    return () => { mounted = false }
  }, [timeRange])

  return (
    <div className="p-4 sm:p-6 lg:p-9 bg-[color:var(--color-sharktank-bg)] min-h-[calc(100vh-4rem)] font-sans w-full overflow-x-hidden">
      {/* Page Header */}
      <div className="mb-4 sm:mb-6 lg:mb-8">
        <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-heading mb-2">Accounts Reports & KPIs</h1>
        <p className="text-sm sm:text-base text-gray-600">Track payment aging, compliance rates, SLA breaches, and payment trends</p>
      </div>

      {/* Top KPI Cards */}
      <div className="mb-6 sm:mb-8">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 pt-6 sm:pt-8 pb-4 sm:pb-6 gap-10 sm:gap-12 xl:gap-6">
          <KPICard
            title="Total Outstanding"
            value={`₹${summaryMetrics.totalOutstanding.toLocaleString('en-IN')}`}
            icon={<Wallet size={32} />}
            subtitle="Pending vendor payments"
          />
          <KPICard
            title="Avg Compliance"
            value={`${summaryMetrics.avgCompliance}%`}
            icon={<CheckSquare size={32} />}
            subtitle="Invoice-PO compliance rate"
          />
          <KPICard
            title="SLA Breaches"
            value={summaryMetrics.totalBreaches}
            icon={<AlertTriangle size={32} />}
            subtitle="Requires attention"
          />
          <KPICard
            title="Payments This Period"
            value={`₹${summaryMetrics.paymentsReleased.toLocaleString('en-IN')}`}
            icon={<BarChart3 size={32} />}
            subtitle={`${timeRange === 'weekly' ? 'This week' : 'This month'}`}
          />
        </div>
      </div>

      {/* Section 1: Vendor Payment Aging */}
      <div className="mb-6 sm:mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 gap-2">
          <h2 className="text-xl sm:text-2xl font-semibold text-[var(--color-heading)]">
            Vendor Payment Aging
          </h2>
         
        </div>
        
        {/* Filter Bar */}
        <div className="mb-4 bg-white border border-gray-200 rounded-xl p-3 sm:p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[var(--color-heading)] text-base sm:text-lg font-medium flex items-center gap-2">
              Filters
            </h3>
            <CSVPDFExportButton
              onExportCSV={handleAgingExportCSV}
              onExportPDF={handleAgingExportPDF}
              buttonClassName="min-h-[42px]"
            />
          </div>
          <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 items-stretch sm:items-end">
            <div className="flex-1">
              <label className="block text-xs sm:text-sm font-medium mb-1 text-gray-700">Vendor</label>
              <input
                type="text"
                value={agingVendorFilter}
                onChange={e => setAgingVendorFilter(e.target.value)}
                placeholder="Search vendor..."
                className="w-full px-3 py-2.5 text-sm rounded-xl border border-gray-300 focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent min-h-[44px]"
              />
            </div>

            <div className="flex-1">
              <label className="block text-xs sm:text-sm font-medium mb-1 text-gray-700">Payment Status</label>
              <CustomDropdown
                value={agingStatusFilter}
                onChange={(value) => setAgingStatusFilter(value)}
                options={[
                  { value: 'all', label: 'All Status' },
                  { value: 'overdue', label: 'Overdue (>30 days)' },
                  { value: 'warning', label: 'Warning (15-30 days)' },
                  { value: 'good', label: 'Good (<15 days)' }
                ]}
                placeholder="All Status"
                className="[&>button]:py-2 [&>button]:xl:py-2.5 [&>button]:2xl:py-3"
              />
            </div>

            <button
              onClick={() => {
                setAgingVendorFilter('')
                setAgingStatusFilter('all')
                setAgingCurrentPage(1)
              }}
              className="bg-white text-secondary border border-secondary hover:bg-secondary hover:text-white transition-all duration-200 px-4 sm:px-6 py-2.5 rounded-xl text-xs sm:text-sm font-medium shadow-sm min-h-[44px] whitespace-nowrap"
            >
              Reset
            </button>
          </div>

          {(agingVendorFilter || agingStatusFilter !== 'all') && (
            <div className="mt-3 pt-3 border-t border-gray-200 flex items-center justify-between">
              <div className="flex flex-wrap gap-2">
                {agingVendorFilter && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-medium">
                    Vendor: {agingVendorFilter}
                    <button onClick={() => setAgingVendorFilter('')} className="hover:bg-blue-200 rounded-full p-0.5">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                    </button>
                  </span>
                )}
                {agingStatusFilter !== 'all' && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-purple-100 text-purple-800 rounded-full text-xs font-medium">
                    Status: {agingStatusFilter === 'overdue' ? 'Overdue' : agingStatusFilter === 'warning' ? 'Warning' : 'Good'}
                    <button onClick={() => setAgingStatusFilter('all')} className="hover:bg-purple-200 rounded-full p-0.5">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                    </button>
                  </span>
                )}
              </div>
              <button
                onClick={() => {
                  setAgingVendorFilter('')
                  setAgingStatusFilter('all')
                }}
                className="text-xs sm:text-sm text-[var(--color-accent)] hover:underline font-medium"
              >
                Clear All
              </button>
            </div>
          )}
        </div>

        

        <div className="rounded-xl shadow-md overflow-hidden border border-white/10 bg-white/70">
          {/* Desktop Table View - Hidden on Mobile */}
          <div className="hidden md:block overflow-x-auto">
            {/* Table head bar */}
            <div className="bg-[#C3754C] text-white">
              <div className="flex justify-between px-3 md:px-4 lg:px-6 py-4 md:py-4 lg:py-5 font-heading font-bold text-sm md:text-base lg:text-[18px] leading-[100%] tracking-[0]">
                <div className="flex-1 text-center">Vendor</div>
                <div className="flex-1 text-center">Outstanding Amount</div>
                <div className="flex-1 text-center">Avg Days Pending</div>
                <div className="flex-1 text-center">Oldest Invoice</div>
              </div>
            </div>

            {/* Body */}
            <div className="bg-white">
              <div className="py-2">
                {loading ? (
                  <div className="bg-white rounded-xl p-12 text-center">
                    <div className="w-12 h-12 border-4 border-[var(--color-accent)] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                    <p className="text-gray-500">Loading payment aging...</p>
                  </div>
                ) : paginatedPaymentAging.length === 0 ? (
                  <div className="px-6 py-8 text-center text-gray-500">No records match the current filters</div>
                ) : (
                  paginatedPaymentAging.map((record) => {
                    const isOverdue = record.oldestInvoiceDays > 30
                    return (
                      <div key={record.vendor} className="flex justify-between px-3 md:px-4 lg:px-6 py-3 md:py-4 items-center hover:bg-gray-50">
                        <div className="flex-1 text-xs md:text-sm font-medium text-gray-800 text-center">{record.vendor}</div>
                        <div className="flex-1 text-xs md:text-sm font-semibold text-[var(--color-primary)] text-center">₹{record.outstandingAmount.toLocaleString('en-IN')}</div>
                        <div className="flex-1 flex items-center justify-center">
                          <span className={`inline-block px-3 py-1 rounded-full text-xs font-semibold ${
                            record.avgDaysPending > 30
                              ? 'bg-red-100 text-red-700 border border-red-300'
                              : record.avgDaysPending > 15
                              ? 'bg-yellow-100 text-yellow-700 border border-yellow-300'
                              : 'bg-green-100 text-green-700 border border-green-300'
                          }`}>
                            {record.avgDaysPending} days
                          </span>
                        </div>
                        <div className="flex-1 text-center">
                          <div className={`text-xs sm:text-sm ${isOverdue ? 'text-red-600 font-semibold' : 'text-gray-700'}`}>{record.oldestInvoiceDate}</div>
                          <div className={`text-xs flex items-center justify-center gap-1 mt-1 ${isOverdue ? 'text-red-600' : 'text-gray-500'}`}>
                            {isOverdue && <AlertTriangle size={12} className="sm:w-3.5 sm:h-3.5" />}
                            <span>{record.oldestInvoiceDays} days old</span>
                          </div>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>

            {filteredPaymentAging.length > 0 && (
              <Pagination
                currentPage={agingCurrentPage}
                totalPages={agingTotalPages}
                totalItems={filteredPaymentAging.length}
                startIndex={agingStartIndex}
                endIndex={agingEndIndex}
                onPageChange={setAgingCurrentPage}
                itemLabel="records"
                variant="desktop"
              />
            )}
          </div>

          {/* Mobile Card View - Visible only on Mobile */}
          <div className="md:hidden">
            {loading ? (
              <div className="bg-white rounded-xl p-12 text-center">
                <div className="w-12 h-12 border-4 border-[var(--color-accent)] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                <p className="text-gray-500">Loading payment aging...</p>
              </div>
            ) : paginatedPaymentAging.length === 0 ? (
              <div className="px-4 py-8 text-center text-gray-500 bg-white">No records match the current filters</div>
            ) : (
              <div className="bg-white divide-y divide-gray-200">
                {paginatedPaymentAging.map((record) => {
                  const isOverdue = record.oldestInvoiceDays > 30
                  return (
                    <div key={record.vendor} className="p-4 hover:bg-gray-50">
                      <div className="font-semibold text-gray-900 mb-3 text-base">{record.vendor}</div>
                      <div className="space-y-2">
                        <div className="flex justify-between items-center">
                          <span className="text-xs text-gray-600">Outstanding Amount:</span>
                          <span className="text-sm font-semibold text-[var(--color-primary)]">₹{record.outstandingAmount.toLocaleString('en-IN')}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-xs text-gray-600">Avg Days Pending:</span>
                          <span className={`inline-block px-3 py-1 rounded-full text-xs font-semibold ${
                            record.avgDaysPending > 30
                              ? 'bg-red-100 text-red-700 border border-red-300'
                              : record.avgDaysPending > 15
                              ? 'bg-yellow-100 text-yellow-700 border border-yellow-300'
                              : 'bg-green-100 text-green-700 border border-green-300'
                          }`}>
                            {record.avgDaysPending} days
                          </span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-xs text-gray-600">Oldest Invoice:</span>
                          <div className="text-right">
                            <div className={`text-sm ${isOverdue ? 'text-red-600 font-semibold' : 'text-gray-700'}`}>{record.oldestInvoiceDate}</div>
                            <div className={`text-xs flex items-center justify-end gap-1 ${isOverdue ? 'text-red-600' : 'text-gray-500'}`}>
                              {isOverdue && <AlertTriangle size={12} />}
                              <span>{record.oldestInvoiceDays} days old</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            {filteredPaymentAging.length > 0 && (
              <Pagination
                currentPage={agingCurrentPage}
                totalPages={agingTotalPages}
                totalItems={filteredPaymentAging.length}
                startIndex={agingStartIndex}
                endIndex={agingEndIndex}
                onPageChange={setAgingCurrentPage}
                itemLabel="records"
                variant="mobile"
              />
            )}
          </div>
        </div>
      </div>

      {/* Section 2: Invoice vs PO Compliance */}
      <div className="mb-6 sm:mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 gap-2">
          <h2 className="text-xl sm:text-2xl font-semibold text-[var(--color-heading)]">
            Invoice vs PO Compliance
          </h2>
          
        </div>

        {/* Filter Bar */}
        <div className="mb-4 bg-white border border-gray-200 rounded-xl p-3 sm:p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[var(--color-heading)] text-base sm:text-lg font-medium flex items-center gap-2">
              Filters
            </h3>
            <CSVPDFExportButton
              onExportCSV={() => {
                const rows = filteredCompliance.map(r => ({ vendor: r.vendor, totalInvoices: r.totalInvoices, compliantPercentage: r.compliantPercentage, issuesFound: r.issuesFound }))
                const csv = toCSV(rows, ['vendor','totalInvoices','compliantPercentage','issuesFound'])
                downloadFile(csv, `compliance_${new Date().toISOString().slice(0,10)}.csv`, 'text/csv;charset=utf-8;')
              }}
              onExportPDF={() => {
                const rows = filteredCompliance
                const html = `
                  <html><head><meta charset="utf-8" />
                  <title>Invoice vs PO Compliance</title>
                  <style>body{font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial;padding:16px;color:#111827}h1{font-size:18px;margin:0 0 12px}table{width:100%;border-collapse:collapse;font-size:12px;background:#fff}th,td{text-align:left;padding:8px;border-bottom:1px solid #e5e7eb}thead{background:#f9fafb}</style>
                  </head><body>
                  <h1>Invoice vs PO Compliance</h1>
                  <table><thead><tr><th>Vendor</th><th>Total Invoices</th><th>Compliant %</th><th>Issues Found</th></tr></thead><tbody>
                  ${rows.map(r => `<tr><td>${r.vendor}</td><td>${r.totalInvoices}</td><td>${r.compliantPercentage}%</td><td>${r.issuesFound}</td></tr>`).join('')}
                  </tbody></table>
                  </body></html>`
                const iframe = document.createElement('iframe')
                iframe.style.position='fixed'; iframe.style.right='0'; iframe.style.bottom='0'; iframe.style.width='0'; iframe.style.height='0'; iframe.style.border='0'
                document.body.appendChild(iframe)
                const doc = iframe.contentWindow?.document
                if (!doc) { document.body.removeChild(iframe); return }
                doc.open(); doc.write(html); doc.close()
                const cleanup = () => { if (iframe.parentNode) document.body.removeChild(iframe) }
                iframe.contentWindow?.addEventListener('afterprint', cleanup, { once: true })
                setTimeout(() => { iframe.contentWindow?.focus(); iframe.contentWindow?.print(); setTimeout(cleanup, 1500) }, 250)
              }}
              buttonClassName="min-h-[42px]"
            />
          </div>
          <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 items-stretch sm:items-end">
            <div className="flex-1">
              <label className="block text-xs sm:text-sm font-medium mb-1 text-gray-700">Vendor</label>
              <input
                type="text"
                value={complianceVendorFilter}
                onChange={e => setComplianceVendorFilter(e.target.value)}
                placeholder="Search vendor..."
                className="w-full px-3 py-2.5 text-sm rounded-xl border border-gray-300 focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent min-h-[44px]"
              />
            </div>

            <div className="flex-1">
              <label className="block text-xs sm:text-sm font-medium mb-1 text-gray-700">Compliance Level</label>
              <CustomDropdown
                value={complianceFilter}
                onChange={(value) => setComplianceFilter(value)}
                options={[
                  { value: 'all', label: 'All Levels' },
                  { value: 'high', label: 'High (≥95%)' },
                  { value: 'medium', label: 'Medium (85-94%)' },
                  { value: 'low', label: 'Low (<85%)' }
                ]}
                placeholder="All Levels"
                className="[&>button]:py-2 [&>button]:xl:py-2.5 [&>button]:2xl:py-3"
              />
            </div>

            <button
              onClick={() => {
                setComplianceVendorFilter('')
                setComplianceFilter('all')
                setComplianceCurrentPage(1)
              }}
              className="bg-white text-secondary border border-secondary hover:bg-secondary hover:text-white transition-all duration-200 px-4 sm:px-6 py-2.5 rounded-xl text-xs sm:text-sm font-medium shadow-sm min-h-[44px] whitespace-nowrap"
            >
              Reset
            </button>
          </div>

          {(complianceVendorFilter || complianceFilter !== 'all') && (
            <div className="mt-3 pt-3 border-t border-gray-200 flex items-center justify-between">
              <div className="flex flex-wrap gap-2">
                {complianceVendorFilter && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-medium">
                    Vendor: {complianceVendorFilter}
                    <button onClick={() => setComplianceVendorFilter('')} className="hover:bg-blue-200 rounded-full p-0.5">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                    </button>
                  </span>
                )}
                {complianceFilter !== 'all' && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-green-100 text-green-800 rounded-full text-xs font-medium">
                    Compliance: {complianceFilter === 'high' ? 'High' : complianceFilter === 'medium' ? 'Medium' : 'Low'}
                    <button onClick={() => setComplianceFilter('all')} className="hover:bg-green-200 rounded-full p-0.5">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                    </button>
                  </span>
                )}
              </div>
              <button
                onClick={() => {
                  setComplianceVendorFilter('')
                  setComplianceFilter('all')
                }}
                className="text-xs sm:text-sm text-[var(--color-accent)] hover:underline font-medium"
              >
                Clear All
              </button>
            </div>
          )}
        </div>

        
        
        {/* Overall Compliance KPI */}
        <div className="mb-4 py-6">
          <KPICard
            title="Overall Compliance Rate"
            value={`${summaryMetrics.avgCompliance}%`}
            subtitle="Invoice-PO compliance rate"
            icon={<CheckSquare size={32} />}
          />
        </div>

        {/* Compliance Table */}
        <div className="rounded-xl shadow-md overflow-hidden border border-white/10 bg-white/70">
          {/* Desktop Table View - Hidden on Mobile */}
          <div className="hidden md:block overflow-x-auto">
            {/* Table head bar */}
            <div className="bg-[#C3754C] text-white">
              <div className="flex justify-between px-3 md:px-4 lg:px-6 py-4 md:py-4 lg:py-5 font-heading font-bold text-sm md:text-base lg:text-[18px] leading-[100%] tracking-[0]">
                <div className="flex-1 text-center">Vendor</div>
                <div className="flex-1 text-center">Total Invoices</div>
                <div className="flex-1 text-center">Compliant %</div>
                <div className="flex-1 text-center">Issues Found</div>
              </div>
            </div>
            {/* Body */}
            <div className="bg-white">
              <div className="py-2">
                {loading ? (
                  <div className="bg-white rounded-xl p-12 text-center">
                    <div className="w-12 h-12 border-4 border-[var(--color-accent)] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                    <p className="text-gray-500">Loading compliance data...</p>
                  </div>
                ) : paginatedCompliance.length === 0 ? (
                  <div className="px-6 py-8 text-center text-gray-500">No records match the current filters</div>
                ) : (
                  paginatedCompliance.map((record) => (
                    <div key={record.vendor} className="flex justify-between px-3 md:px-4 lg:px-6 py-3 md:py-4 items-center hover:bg-gray-50">
                      <div className="flex-1 text-xs md:text-sm font-medium text-gray-800 text-center">{record.vendor}</div>
                      <div className="flex-1 text-xs md:text-sm text-gray-700 text-center">{record.totalInvoices}</div>
                      <div className="flex-1 flex items-center justify-center gap-2 sm:gap-3">
                        <div className="flex-1 bg-gray-200 rounded-full h-2 max-w-[120px]">
                          <div
                            className={`h-2 rounded-full transition-all ${
                              record.compliantPercentage >= 95
                                ? 'bg-green-600'
                                : record.compliantPercentage >= 85
                                ? 'bg-yellow-500'
                                : 'bg-red-600'
                            }`}
                            style={{ width: `${record.compliantPercentage}%` }}
                          />
                        </div>
                        <span
                          className={`font-semibold text-xs sm:text-sm ${
                            record.compliantPercentage >= 95
                              ? 'text-green-600'
                              : record.compliantPercentage >= 85
                              ? 'text-yellow-600'
                              : 'text-red-600'
                          }`}
                        >
                          {record.compliantPercentage}%
                        </span>
                      </div>
                      <div className="flex-1 flex items-center justify-center">
                        <span
                          className={`inline-block px-2 py-1 sm:px-3 rounded-full text-xs sm:text-sm font-semibold whitespace-nowrap ${
                            record.issuesFound === 0
                              ? 'bg-green-100 text-green-700 border border-green-300'
                              : record.issuesFound <= 3
                              ? 'bg-yellow-100 text-yellow-700 border border-yellow-300'
                              : 'bg-red-100 text-red-700 border border-red-300'
                          }`}
                        >
                          {record.issuesFound}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
            {filteredCompliance.length > 0 && (
              <Pagination
                currentPage={complianceCurrentPage}
                totalPages={complianceTotalPages}
                totalItems={filteredCompliance.length}
                startIndex={complianceStartIndex}
                endIndex={complianceEndIndex}
                onPageChange={setComplianceCurrentPage}
                itemLabel="records"
                variant="desktop"
              />
            )}
          </div>

          {/* Mobile Card View - Visible only on Mobile */}
          <div className="md:hidden">
            {loading ? (
              <div className="bg-white rounded-xl p-12 text-center">
                <div className="w-12 h-12 border-4 border-[var(--color-accent)] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                <p className="text-gray-500">Loading compliance data...</p>
              </div>
            ) : paginatedCompliance.length === 0 ? (
              <div className="px-4 py-8 text-center text-gray-500 bg-white">No records match the current filters</div>
            ) : (
              <div className="bg-white divide-y divide-gray-200">
                {paginatedCompliance.map((record) => (
                  <div key={record.vendor} className="p-4 hover:bg-gray-50">
                    <div className="font-semibold text-gray-900 mb-3 text-base">{record.vendor}</div>
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-gray-600">Total Invoices:</span>
                        <span className="text-sm font-medium text-gray-700">{record.totalInvoices}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-gray-600">Compliant %:</span>
                        <div className="flex items-center gap-2">
                          <div className="w-20 bg-gray-200 rounded-full h-2">
                            <div
                              className={`h-2 rounded-full transition-all ${
                                record.compliantPercentage >= 95
                                  ? 'bg-green-600'
                                  : record.compliantPercentage >= 85
                                  ? 'bg-yellow-500'
                                  : 'bg-red-600'
                              }`}
                              style={{ width: `${record.compliantPercentage}%` }}
                            />
                          </div>
                          <span
                            className={`font-semibold text-sm ${
                              record.compliantPercentage >= 95
                                ? 'text-green-600'
                                : record.compliantPercentage >= 85
                                ? 'text-yellow-600'
                                : 'text-red-600'
                            }`}
                          >
                            {record.compliantPercentage}%
                          </span>
                        </div>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-gray-600">Issues Found:</span>
                        <span
                          className={`inline-block px-3 py-1 rounded-full text-xs font-semibold ${
                            record.issuesFound === 0
                              ? 'bg-green-100 text-green-700 border border-green-300'
                              : record.issuesFound <= 3
                              ? 'bg-yellow-100 text-yellow-700 border border-yellow-300'
                              : 'bg-red-100 text-red-700 border border-red-300'
                          }`}
                        >
                          {record.issuesFound}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {filteredCompliance.length > 0 && (
              <Pagination
                currentPage={complianceCurrentPage}
                totalPages={complianceTotalPages}
                totalItems={filteredCompliance.length}
                startIndex={complianceStartIndex}
                endIndex={complianceEndIndex}
                onPageChange={setComplianceCurrentPage}
                itemLabel="records"
                variant="mobile"
              />
            )}
          </div>
        </div>
      </div>

      {/* Section 3: SLA Breaches */}
      <div className="mb-6 sm:mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 gap-2">
          <h2 className="text-xl sm:text-2xl font-semibold text-[var(--color-heading)]">
            SLA Breaches
          </h2>
          
        </div>

        {/* Filter Bar */}
        <div className="mb-4 bg-white border border-gray-200 rounded-xl p-3 sm:p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[var(--color-heading)] text-base sm:text-lg font-medium flex items-center gap-2">
              
              Filters
            </h3>
            <CSVPDFExportButton
              onExportCSV={() => {
                const rows = filteredSLABreaches.map(r => ({ slaType: r.slaType, breachCount: r.breachCount, avgDelayDays: r.avgDelayDays }))
                const csv = toCSV(rows, ['slaType','breachCount','avgDelayDays'])
                downloadFile(csv, `sla_breaches_${new Date().toISOString().slice(0,10)}.csv`, 'text/csv;charset=utf-8;')
              }}
              onExportPDF={() => {
                const rows = filteredSLABreaches
                const html = `
                  <html><head><meta charset="utf-8" />
                  <title>SLA Breaches</title>
                  <style>body{font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial;padding:16px;color:#111827}h1{font-size:18px;margin:0 0 12px}table{width:100%;border-collapse:collapse;font-size:12px;background:#fff}th,td{text-align:left;padding:8px;border-bottom:1px solid #e5e7eb}thead{background:#f9fafb}</style>
                  </head><body>
                  <h1>SLA Breaches</h1>
                  <table><thead><tr><th>SLA Type</th><th>Breaches</th><th>Avg Delay (Days)</th></tr></thead><tbody>
                  ${rows.map(r => `<tr><td>${r.slaType}</td><td>${r.breachCount}</td><td>${r.avgDelayDays}</td></tr>`).join('')}
                  </tbody></table>
                  </body></html>`
                const iframe = document.createElement('iframe')
                iframe.style.position='fixed'; iframe.style.right='0'; iframe.style.bottom='0'; iframe.style.width='0'; iframe.style.height='0'; iframe.style.border='0'
                document.body.appendChild(iframe)
                const doc = iframe.contentWindow?.document
                if (!doc) { document.body.removeChild(iframe); return }
                doc.open(); doc.write(html); doc.close()
                const cleanup = () => { if (iframe.parentNode) document.body.removeChild(iframe) }
                iframe.contentWindow?.addEventListener('afterprint', cleanup, { once: true })
                setTimeout(() => { iframe.contentWindow?.focus(); iframe.contentWindow?.print(); setTimeout(cleanup, 1500) }, 250)
              }}
              buttonClassName="min-h-[42px]"
            />
          </div>
          <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 items-stretch sm:items-end flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs sm:text-sm font-medium mb-1 text-gray-700">SLA Type</label>
              <CustomDropdown
                value={slaTypeFilter}
                onChange={(value) => setSlaTypeFilter(value)}
                options={[
                  { value: 'all', label: 'All SLA Types' },
                  { value: 'Invoice Validation', label: 'Invoice Validation' },
                  { value: 'Payment Release', label: 'Payment Release' },
                  { value: 'Delivery Confirmation', label: 'Delivery Confirmation' },
                  { value: 'Vendor Response Time', label: 'Vendor Response Time' }
                ]}
                placeholder="All SLA Types"
                className="[&>button]:py-2 [&>button]:xl:py-2.5 [&>button]:2xl:py-3"
              />
            </div>

            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs sm:text-sm font-medium mb-1 text-gray-700">Breach Severity</label>
              <CustomDropdown
                value={slaBreachSeverity}
                onChange={(value) => setSlaBreachSeverity(value)}
                options={[
                  { value: 'all', label: 'All Severities' },
                  { value: 'high', label: 'High (≥12 breaches)' },
                  { value: 'medium', label: 'Medium (8-11 breaches)' },
                  { value: 'low', label: 'Low (<8 breaches)' }
                ]}
                placeholder="All Severities"
                className="[&>button]:py-2 [&>button]:xl:py-2.5 [&>button]:2xl:py-3"
              />
            </div>

            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs sm:text-sm font-medium mb-1 text-gray-700">Delay Severity</label>
              <CustomDropdown
                value={slaDelaySeverity}
                onChange={(value) => setSlaDelaySeverity(value)}
                options={[
                  { value: 'all', label: 'All Delays' },
                  { value: 'critical', label: 'Critical (>5 days)' },
                  { value: 'moderate', label: 'Moderate (3-5 days)' },
                  { value: 'minor', label: 'Minor (≤3 days)' }
                ]}
                placeholder="All Delays"
                className="[&>button]:py-2 [&>button]:xl:py-2.5 [&>button]:2xl:py-3"
              />
            </div>

            <button
              onClick={() => {
                setSlaTypeFilter('all')
                setSlaBreachSeverity('all')
                setSlaDelaySeverity('all')
                setSlaCurrentPage(1)
              }}
              className="bg-white text-secondary border border-secondary hover:bg-secondary hover:text-white transition-all duration-200 px-4 sm:px-6 py-2.5 rounded-xl text-xs sm:text-sm font-medium shadow-sm min-h-[44px] whitespace-nowrap"
            >
              Reset
            </button>
          </div>

          {(slaTypeFilter !== 'all' || slaBreachSeverity !== 'all' || slaDelaySeverity !== 'all') && (
            <div className="mt-3 pt-3 border-t border-gray-200 flex items-center justify-between">
              <div className="flex flex-wrap gap-2">
                {slaTypeFilter !== 'all' && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-orange-100 text-orange-800 rounded-full text-xs font-medium">
                    SLA: {slaTypeFilter}
                    <button onClick={() => setSlaTypeFilter('all')} className="hover:bg-orange-200 rounded-full p-0.5">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                    </button>
                  </span>
                )}
                {slaBreachSeverity !== 'all' && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-red-100 text-red-800 rounded-full text-xs font-medium">
                    Breach: {slaBreachSeverity === 'high' ? 'High' : slaBreachSeverity === 'medium' ? 'Medium' : 'Low'}
                    <button onClick={() => setSlaBreachSeverity('all')} className="hover:bg-red-200 rounded-full p-0.5">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                    </button>
                  </span>
                )}
                {slaDelaySeverity !== 'all' && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-yellow-100 text-yellow-800 rounded-full text-xs font-medium">
                    Delay: {slaDelaySeverity === 'critical' ? 'Critical' : slaDelaySeverity === 'moderate' ? 'Moderate' : 'Minor'}
                    <button onClick={() => setSlaDelaySeverity('all')} className="hover:bg-yellow-200 rounded-full p-0.5">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                    </button>
                  </span>
                )}
              </div>
              <button
                onClick={() => {
                  setSlaTypeFilter('all')
                  setSlaBreachSeverity('all')
                  setSlaDelaySeverity('all')
                }}
                className="text-xs sm:text-sm text-[var(--color-accent)] hover:underline font-medium"
              >
                Clear All
              </button>
            </div>
          )}
        </div>

        {/* Export actions (moved into header above) */}
        
        {/* Full-width table with visual bars */}
        <div className="rounded-xl shadow-md overflow-hidden border border-white/10 bg-white/70">
          {/* Desktop Table View - Hidden on Mobile */}
          <div className="hidden md:block overflow-x-auto">
            {/* Table head bar */}
            <div className="bg-[#C3754C] text-white">
              <div className="flex justify-between px-3 md:px-4 lg:px-6 py-4 md:py-4 lg:py-5 font-heading font-bold text-sm md:text-base lg:text-[18px] leading-[100%] tracking-[0]">
                <div className="flex-1 text-center">SLA Type</div>
                <div className="flex-1 text-center">Breaches Count</div>
                <div className="flex-1 text-center">Avg Delay (Days)</div>
                <div className="flex-1 text-center">Breach Visualization</div>
              </div>
            </div>
            {/* Body */}
            <div className="bg-white">
              <div className="py-2">
                {loading ? (
                  <div className="bg-white rounded-xl p-12 text-center">
                    <div className="w-12 h-12 border-4 border-[var(--color-accent)] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                    <p className="text-gray-500">Loading SLA breaches...</p>
                  </div>
                ) : paginatedSLABreaches.length === 0 ? (
                  <div className="px-6 py-8 text-center text-gray-500">No records match the current filters</div>
                ) : (
                  paginatedSLABreaches.map((record) => {
                    const maxBreaches = Math.max(...filteredSLABreaches.map(r => r.breachCount))
                    const barWidth = (record.breachCount / maxBreaches) * 100
                  
                  return (
                    <div key={record.slaType} className="flex justify-between px-3 md:px-4 lg:px-6 py-3 md:py-4 items-center hover:bg-gray-50">
                      <div className="flex-1 text-xs md:text-sm font-medium text-gray-800 text-center flex items-center justify-center gap-2">
                        <AlertTriangle size={16} className="sm:w-4.5 sm:h-4.5 text-red-600 flex-shrink-0" />
                        <span>{record.slaType}</span>
                      </div>
                      <div className="flex-1 flex items-center justify-center">
                        <span className="inline-block px-2 py-1 sm:px-3 sm:py-1.5 rounded-full text-xs sm:text-sm font-bold bg-red-100 text-red-700 border border-red-300 whitespace-nowrap">
                          {record.breachCount}
                        </span>
                      </div>
                      <div className="flex-1 text-center">
                        <span className={`font-semibold text-sm sm:text-base ${
                          record.avgDelayDays > 5 
                            ? 'text-red-600' 
                            : record.avgDelayDays > 3 
                            ? 'text-orange-600' 
                            : 'text-yellow-600'
                        }`}>
                          {record.avgDelayDays} days
                        </span>
                      </div>
                      <div className="flex-1 flex items-center justify-center px-4">
                        <div className="flex items-center gap-2 w-full max-w-[240px]">
                          <div className="flex-1 bg-gray-200 rounded-full h-4 sm:h-6">
                            <div
                              className="bg-gradient-to-r from-red-500 to-red-600 h-4 sm:h-6 rounded-full flex items-center justify-end pr-1 sm:pr-2 transition-all"
                              style={{ width: `${barWidth}%` }}
                            >
                              {barWidth > 25 && (
                                <span className="text-xs font-bold text-white">{record.breachCount}</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                  })
                )}
              </div>
            </div>
            {filteredSLABreaches.length > 0 && (
              <Pagination
                currentPage={slaCurrentPage}
                totalPages={slaTotalPages}
                totalItems={filteredSLABreaches.length}
                startIndex={slaStartIndex}
                endIndex={slaEndIndex}
                onPageChange={setSlaCurrentPage}
                itemLabel="records"
                variant="desktop"
              />
            )}
          </div>

          {/* Mobile Card View - Visible only on Mobile */}
          <div className="md:hidden">
            {paginatedSLABreaches.length === 0 ? (
              <div className="px-4 py-8 text-center text-gray-500 bg-white">No records match the current filters</div>
            ) : (
              <div className="bg-white divide-y divide-gray-200">
                {paginatedSLABreaches.map((record) => {
                  const maxBreaches = Math.max(...filteredSLABreaches.map(r => r.breachCount))
                  const barWidth = (record.breachCount / maxBreaches) * 100
                
                return (
                  <div key={record.slaType} className="p-4 hover:bg-gray-50">
                    <div className="flex items-center gap-2 mb-3">
                      <AlertTriangle size={16} className="text-red-600 flex-shrink-0" />
                      <div className="font-semibold text-gray-900 text-base">{record.slaType}</div>
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-gray-600">Breaches Count:</span>
                        <span className="inline-block px-3 py-1 rounded-full text-xs font-bold bg-red-100 text-red-700 border border-red-300">
                          {record.breachCount}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-gray-600">Avg Delay:</span>
                        <span className={`font-semibold text-sm ${
                          record.avgDelayDays > 5 
                            ? 'text-red-600' 
                            : record.avgDelayDays > 3 
                            ? 'text-orange-600' 
                            : 'text-yellow-600'
                        }`}>
                          {record.avgDelayDays} days
                        </span>
                      </div>
                      <div className="mt-2">
                        <span className="text-xs text-gray-600 mb-1 block">Breach Visualization:</span>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 bg-gray-200 rounded-full h-5">
                            <div
                              className="bg-gradient-to-r from-red-500 to-red-600 h-5 rounded-full flex items-center justify-end pr-2 transition-all"
                              style={{ width: `${barWidth}%` }}
                            >
                              {barWidth > 20 && (
                                <span className="text-xs font-bold text-white">{record.breachCount}</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )
                })}
              </div>
            )}
            {filteredSLABreaches.length > 0 && (
              <Pagination
                currentPage={slaCurrentPage}
                totalPages={slaTotalPages}
                totalItems={filteredSLABreaches.length}
                startIndex={slaStartIndex}
                endIndex={slaEndIndex}
                onPageChange={setSlaCurrentPage}
                itemLabel="records"
                variant="mobile"
              />
            )}
          </div>
          
          {/* Summary footer */}
          <div className="bg-red-50 border-t border-red-200 p-3 sm:p-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs sm:text-sm">
              <div className="flex items-center gap-2 text-red-800 font-medium">
                <AlertTriangle size={14} className="sm:w-4 sm:h-4" />
                <span>Total SLA Breaches: <strong>{totalSlaBreaches}</strong></span>
              </div>
              <div className="text-red-700">
                Avg Delay Across All Types: <strong>{avgDelayAcrossAll.toFixed(1)} days</strong>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Section 4: Payment Summary */}
      <div className="mb-6 sm:mb-8">
        <h2 className="text-xl sm:text-2xl font-semibold text-[var(--color-heading)] mb-4">
          Payment Summary
        </h2>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-6 mb-4 sm:mb-6 py-6">
          <KPICard
            title={`Payments Released This ${timeRange === 'weekly' ? 'Week' : 'Month'}`}
            value={`₹${summaryMetrics.paymentsReleased.toLocaleString('en-IN')}`}
            subtitle=""
            icon={<CheckSquare size={32} />}
          />
          <KPICard
            title="Pending Payments"
            value={`₹${summaryMetrics.pendingPayments.toLocaleString('en-IN')}`}
            subtitle=""
            icon={<Clock size={32} />}
          />
        </div>

        {/* Chart with Toggle */}
        <div className="bg-white p-4 sm:p-6 rounded-xl shadow-md border border-white/20">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4 sm:mb-6">
            <h3 className="text-base sm:text-lg font-semibold text-[#2d3748]">Payment Trends</h3>
            <div className="flex gap-2 bg-gray-100 rounded-full p-1 w-full sm:w-auto">
              <button
                onClick={() => setTimeRange('weekly')}
                className={`flex-1 sm:flex-none px-4 py-2.5 sm:px-4 sm:py-2 rounded-full text-xs sm:text-sm font-medium transition-all min-h-[44px] sm:min-h-0 ${
                  timeRange === 'weekly'
                    ? 'bg-[var(--color-accent)] text-[var(--color-button-text)] shadow-sm'
                    : 'text-gray-600 hover:text-gray-900 active:bg-gray-200'
                }`}
              >
                Weekly
              </button>
              <button
                onClick={() => setTimeRange('monthly')}
                className={`flex-1 sm:flex-none px-4 py-2.5 sm:px-4 sm:py-2 rounded-full text-xs sm:text-sm font-medium transition-all min-h-[44px] sm:min-h-0 ${
                  timeRange === 'monthly'
                    ? 'bg-[var(--color-accent)] text-[var(--color-button-text)] shadow-sm'
                    : 'text-gray-600 hover:text-gray-900 active:bg-gray-200'
                }`}
              >
                Monthly
              </button>
              <button
                onClick={() => setTimeRange('yearly')}
                className={`flex-1 sm:flex-none px-4 py-2.5 sm:px-4 sm:py-2 rounded-full text-xs sm:text-sm font-medium transition-all min-h-[44px] sm:min-h-0 ${
                  timeRange === 'yearly'
                    ? 'bg-[var(--color-accent)] text-[var(--color-button-text)] shadow-sm'
                    : 'text-gray-600 hover:text-gray-900 active:bg-gray-200'
                }`}
              >
                Yearly
              </button>
            </div>
          </div>

          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={paymentChartData}>
              <XAxis 
                dataKey="period" 
                fontSize={12}
                tick={{ fontSize: 12 }}
              />
              <YAxis 
                tickFormatter={(value) => `₹${(value / 1000)}K`} 
                fontSize={12}
                tick={{ fontSize: 12 }}
              />
              <Tooltip 
                formatter={(value: number) => `₹${value.toLocaleString('en-IN')}`}
                labelStyle={{ fontSize: 12 }}
                contentStyle={{ fontSize: 12 }}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="released"
                stroke="var(--color-secondary)"
                strokeWidth={2}
                name="Released"
                dot={{ r: 4 }}
                activeDot={{ r: 6 }}
              />
              <Line
                type="monotone"
                dataKey="pending"
                stroke="var(--color-accent)"
                strokeWidth={2}
                name="Pending"
                dot={{ r: 4 }}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}

export default AccountsReports

