// Shared metrics builder used by both /users/metrics and /ext/metrics.json
// Consumes cached libraries (from activityMonitor + libraryCache) and only
// falls back to Stremio API when cache is missing.

/**
 * Build metrics for a given account and period.
 *
 * @param {object} params
 * @param {import('@prisma/client').PrismaClient} params.prisma
 * @param {string} params.accountId
 * @param {string} params.period - '7d' | '30d' | '90d' | '1y' | 'all'
 * @param {Function} params.decrypt - decrypt(stremioAuthKey, reqLike)
 * @returns {Promise<object>} metrics payload compatible with /users/metrics response
 */
async function buildMetricsForAccount({ prisma, accountId, period = '30d', decrypt }) {
  if (!accountId) {
    throw new Error('accountId is required to build metrics')
  }

  // Calculate date range based on period
  let startDate = new Date()
  switch (period) {
    case '1h':
      startDate.setHours(startDate.getHours() - 1)
      break
    case '12h':
      startDate.setHours(startDate.getHours() - 12)
      break
    case '1d':
      startDate.setDate(startDate.getDate() - 1)
      break
    case '3d':
      startDate.setDate(startDate.getDate() - 3)
      break
    case '7d':
      startDate.setDate(startDate.getDate() - 7)
      break
    case '30d':
      startDate.setDate(startDate.getDate() - 30)
      break
    case '90d':
      startDate.setDate(startDate.getDate() - 90)
      break
    case '1y':
      startDate.setFullYear(startDate.getFullYear() - 1)
      break
    case 'all':
      startDate = new Date(0)
      break
    default:
      startDate.setDate(startDate.getDate() - 30)
  }

  // Get all users for this account
  const allUsers = await prisma.user.findMany({
    where: { accountId },
    select: {
      id: true,
      username: true,
      email: true,
      createdAt: true,
      isActive: true,
      stremioAuthKey: true,
      inviteCode: true,
      providerType: true,
      nuvioRefreshToken: true,
      nuvioUserId: true
    },
    orderBy: { createdAt: 'asc' }
  })

  // User joins
  const userJoinsByDay = {}
  const userJoinsByWeek = {}
  const userJoinsByMonth = {}

  allUsers.forEach(user => {
    const date = new Date(user.createdAt)
    if (period !== 'all' && date < startDate) return

    const dayKey = date.toISOString().split('T')[0]
    userJoinsByDay[dayKey] = (userJoinsByDay[dayKey] || 0) + 1

    const weekStart = new Date(date)
    weekStart.setDate(date.getDate() - date.getDay())
    const weekNum = Math.ceil((weekStart.getDate() + 6) / 7)
    const weekKey = `${weekStart.getFullYear()}-W${String(weekNum).padStart(2, '0')}`
    userJoinsByWeek[weekKey] = (userJoinsByWeek[weekKey] || 0) + 1

    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    userJoinsByMonth[monthKey] = (userJoinsByMonth[monthKey] || 0) + 1
  })

  // Watch activity & time from WatchActivity table (accurate daily deltas)
  const activeUsers = allUsers.filter(u => u.isActive && (u.stremioAuthKey || u.nuvioRefreshToken))
  const watchActivityByDay = {}
  const watchActivityByUser = {}
  const watchTimeByDay = {}
  const watchActivityByDayPerUser = {}
  const watchTimeByItem = {} // Track watch time per itemId
  let totalMovies = 0
  let totalShows = 0
  let totalWatchTime = 0

  // Try to use WatchActivity first (accurate daily deltas)
  const accountIdValue = accountId || 'default'
  const startDateStr = startDate.toISOString().split('T')[0]
  
  // Track if we have any WatchActivity data
  let hasWatchActivityData = false
  let earliestWatchActivityDate = null
  let earliestSnapshotDate = null
  
  // Find the earliest snapshot date to know when we started tracking
  try {
    const earliestSnapshot = await prisma.watchSnapshot.findFirst({
      where: {
        accountId: accountIdValue
      },
      select: {
        date: true
      },
      orderBy: {
        date: 'asc'
      }
    })
    if (earliestSnapshot) {
      earliestSnapshotDate = earliestSnapshot.date
    }
  } catch (error) {
    console.warn(`[Metrics] Error fetching earliest snapshot:`, error.message)
  }
  
  try {
    // For short periods (1h, 12h, 1d, 3d), filter by createdAt timestamp, not just date
    // For longer periods, date filtering is sufficient
    const useTimestampFilter = period === '1h' || period === '12h' || period === '1d' || period === '3d'
    
    const whereClause = {
      accountId: accountIdValue
    }
    
    if (useTimestampFilter) {
      // Filter by createdAt timestamp for accurate short-period filtering
      whereClause.createdAt = {
        gte: startDate
      }
    } else {
      // Filter by date field for longer periods
      whereClause.date = {
        gte: new Date(startDateStr)
      }
    }
    
    const watchActivities = await prisma.watchActivity.findMany({
      where: whereClause,
      select: {
        userId: true,
        itemId: true,
        date: true,
        createdAt: true,
        watchTimeSeconds: true,
        itemType: true
      },
      orderBy: { date: 'asc' }
    })
    
    hasWatchActivityData = watchActivities.length > 0
    if (hasWatchActivityData) {
      earliestWatchActivityDate = watchActivities[0].date
    }
    
    // Use earliest snapshot date if available (either as the start date, or if earlier than WatchActivity)
    if (earliestSnapshotDate) {
      if (!earliestWatchActivityDate || earliestSnapshotDate < earliestWatchActivityDate) {
        earliestWatchActivityDate = earliestSnapshotDate
      }
    }

    // Process WatchActivity data
    const userItemSet = new Set() // Track unique user+item combinations for counting
    const userItemByDay = new Map() // Track unique items per day per user

    for (const activity of watchActivities) {
      const userId = activity.userId
      const itemId = activity.itemId
      const date = activity.date.toISOString().split('T')[0]
      let watchTime = activity.watchTimeSeconds || 0
      const itemType = activity.itemType

      // For "1h" period, cap watch time at 1 hour (3600 seconds) per activity
      // This prevents showing more than 1 hour when activities span longer periods
      if (period === '1h' && watchTime > 3600) {
        watchTime = 3600
      }

      // Initialize user data
      if (!watchActivityByUser[userId]) {
        watchActivityByUser[userId] = {
          id: userId,
          username: allUsers.find(u => u.id === userId)?.username || allUsers.find(u => u.id === userId)?.email || userId,
          movies: 0,
          shows: 0,
          total: 0,
          watchTime: 0,
          watchTimeMovies: 0,
          watchTimeShows: 0
        }
      }
      if (!watchActivityByDayPerUser[userId]) {
        watchActivityByDayPerUser[userId] = {}
      }
      if (!watchActivityByDayPerUser[userId][date]) {
        watchActivityByDayPerUser[userId][date] = { movies: 0, shows: 0, total: 0 }
      }
      if (!watchActivityByDay[date]) {
        watchActivityByDay[date] = { movies: 0, shows: 0, total: 0 }
      }
      if (!watchTimeByDay[date]) {
        watchTimeByDay[date] = 0
      }

      // Only count items and watch time if the date is on or after the earliest tracking date
      const activityDateStr = date
      const shouldCount = !earliestWatchActivityDate || activityDateStr >= earliestWatchActivityDate.toISOString().split('T')[0]
      
      if (shouldCount) {
        // Track unique items (count once per user, not per day)
        const userItemKey = `${userId}:${itemId}`
        if (!userItemSet.has(userItemKey)) {
          userItemSet.add(userItemKey)
          if (itemType === 'movie') {
            watchActivityByUser[userId].movies++
            totalMovies++
          } else if (itemType === 'series') {
            watchActivityByUser[userId].shows++
            totalShows++
          }
          watchActivityByUser[userId].total++
        }
        
        // Accumulate watch time
        watchActivityByUser[userId].watchTime += watchTime
        watchTimeByDay[date] += watchTime
        totalWatchTime += watchTime

        if (itemType === 'movie') {
          watchActivityByUser[userId].watchTimeMovies += watchTime
        } else if (itemType === 'series') {
          watchActivityByUser[userId].watchTimeShows += watchTime
        }
        
        // Track watch time per itemId
        if (!watchTimeByItem[itemId]) {
          watchTimeByItem[itemId] = {
            itemId,
            itemType,
            watchTimeSeconds: 0,
            watchTimeHours: 0
          }
        }
        watchTimeByItem[itemId].watchTimeSeconds += watchTime
      }

      // Track unique items per day (for daily activity counts)
      const dayUserItemKey = `${date}:${userId}:${itemId}`
      if (!userItemByDay.has(dayUserItemKey)) {
        userItemByDay.set(dayUserItemKey, true)
        if (itemType === 'movie') {
          watchActivityByDay[date].movies++
          watchActivityByDayPerUser[userId][date].movies++
        } else if (itemType === 'series') {
          watchActivityByDay[date].shows++
          watchActivityByDayPerUser[userId][date].shows++
        }
        watchActivityByDay[date].total++
        watchActivityByDayPerUser[userId][date].total++
      }
    }
  } catch (error) {
    console.warn(`[Metrics] Error fetching WatchActivity, falling back to library processing:`, error.message)
    // Fall through to library processing below
  }

  const userJoinsChart = Object.entries(userJoinsByDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count: Number(count) }))

  // Filter watchActivityChart to only include dates from earliest WatchActivity snapshot
  const watchActivityChart = Object.entries(watchActivityByDay)
    .filter(([date]) => {
      // Always respect earliest snapshot/activity date if available
      if (earliestWatchActivityDate) {
        return date >= earliestWatchActivityDate.toISOString().split('T')[0]
      }
      return true
    })
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, data]) => ({
      date,
      movies: data.movies,
      shows: data.shows,
      total: data.total
    }))

  // Filter watchTimeChart similarly
  const watchTimeChart = Object.entries(watchTimeByDay)
    .filter(([date]) => {
      if (earliestWatchActivityDate) {
        return date >= earliestWatchActivityDate.toISOString().split('T')[0]
      }
      return true
    })
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, seconds]) => ({
      date,
      hours: Math.round((seconds / 3600) * 100) / 100
    }))

  // Filter users to only include those with activity after earliest tracking date
  const filteredUsers = Object.values(watchActivityByUser).filter(user => {
    // If we have an earliest date, check if user has any activity after that date
    if (earliestWatchActivityDate) {
      const userDays = watchActivityByDayPerUser[user.id] || {}
      const earliestDateStr = earliestWatchActivityDate.toISOString().split('T')[0]
      // Check if user has any activity on or after the earliest tracking date
      return Object.keys(userDays).some(date => date >= earliestDateStr)
    }
    return true // If no earliest date, include all users
  })
  
  const topUsers = filteredUsers
    .sort((a, b) => b.total - a.total)
    .slice(0, 10)
    .map(user => ({
      ...user,
      watchTimeHours: Math.round((user.watchTime / 3600) * 100) / 100,
      watchTimeMoviesHours: Math.round((user.watchTimeMovies / 3600) * 100) / 100,
      watchTimeShowsHours: Math.round((user.watchTimeShows / 3600) * 100) / 100
    }))

  const activeUserCount = Object.values(watchActivityByUser).filter(u => u.total > 0).length

  const watchActivityByUserByDayCharts = Object.fromEntries(
    Object.entries(watchActivityByDayPerUser).map(([userId, days]) => {
      const series = Object.entries(days)
        .filter(([date]) => {
          // Always respect earliest snapshot/activity date if available
          if (earliestWatchActivityDate) {
            return date >= earliestWatchActivityDate.toISOString().split('T')[0]
          }
          return true
        })
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, data]) => ({
          date,
          movies: data.movies,
          shows: data.shows,
          total: data.total
        }))
      return [userId, series]
    })
  )

  // Convert watchTimeByItem to array and calculate hours
  const watchTimeByItemArray = Object.values(watchTimeByItem)
    .map(item => ({
      ...item,
      watchTimeHours: Math.round((item.watchTimeSeconds / 3600) * 100) / 100
    }))
    .sort((a, b) => b.watchTimeSeconds - a.watchTimeSeconds) // Sort by watch time descending

  return {
    summary: {
      totalUsers: allUsers.length,
      activeUsers: activeUserCount,
      totalMovies,
      totalShows,
      totalWatched: totalMovies + totalShows,
      totalWatchTimeHours: Math.round((totalWatchTime / 3600) * 100) / 100
    },
    userJoins: {
      byDay: userJoinsChart,
      byWeek: Object.entries(userJoinsByWeek).map(([week, count]) => ({ week, count: Number(count) })),
      byMonth: Object.entries(userJoinsByMonth).map(([month, count]) => ({ month, count: Number(count) }))
    },
    watchActivity: {
      byDay: watchActivityChart,
      byUser: topUsers,
      byUserByDay: watchActivityByUserByDayCharts
    },
    watchTime: {
      byDay: watchTimeChart,
      byItem: watchTimeByItemArray
    },
    period
  }
}

module.exports = {
  buildMetricsForAccount
}











