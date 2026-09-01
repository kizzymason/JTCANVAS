import React from 'react'
import { Tag } from 'antd'
import type { AccountStatus } from '../types'

const STATUS_MAP: Record<AccountStatus, { color: string; text: string }> = {
  pending: { color: 'default', text: '待处理' },
  running: { color: 'processing', text: '进行中' },
  completed: { color: 'success', text: '已完成' },
  failed: { color: 'error', text: '失败' },
}

const StatusTag: React.FC<{ status: string }> = ({ status }) => {
  const config = STATUS_MAP[status as AccountStatus] ?? { color: 'default', text: status }
  return <Tag color={config.color}>{config.text}</Tag>
}

export default StatusTag
