import React, { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Empty,
  Input,
  Radio,
  Space,
  Table,
  Typography,
} from 'antd'
import { CopyOutlined, DownloadOutlined, KeyOutlined, ReloadOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { accountApi, downloadUrl, errorMessage } from '../services/api'
import StatusTag from '../components/StatusTag'
import type { Account, AccountStatus } from '../types'

const { Paragraph, Text } = Typography

type ScopeOption = AccountStatus | 'all'

const ExportData: React.FC = () => {
  const { message } = App.useApp()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(false)
  const [syncingKeys, setSyncingKeys] = useState(false)
  const [scope, setScope] = useState<ScopeOption>('completed')
  const [includeSecrets, setIncludeSecrets] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const data = await accountApi.list(scope === 'all' ? undefined : scope)
      setAccounts(data.accounts)
    } catch (err) {
      message.error(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [message, scope])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  /**
   * The file is produced by the server and fetched as a normal navigation, so no
   * Blob juggling in the browser (the previous version stringified a Promise).
   */
  const handleDownload = (format: 'csv' | 'json' | 'txt') => {
    const params: Record<string, string> = {}
    if (scope !== 'all') params.status = scope
    if (includeSecrets) params.includePasswords = 'true'

    const link = document.createElement('a')
    link.href = downloadUrl(format, params)
    link.rel = 'noopener'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    message.success(`已开始下载 ${format.toUpperCase()} 文件`)
  }

  const copyAll = async (field: 'apiKey' | 'cookieToken') => {
    const values = accounts.map((a) => a[field]).filter((v): v is string => Boolean(v))
    if (values.length === 0) {
      message.warning('没有可复制的内容')
      return
    }
    try {
      await navigator.clipboard.writeText(values.join('\n'))
      message.success(`已复制 ${values.length} 条`)
    } catch {
      message.error('浏览器拒绝了剪贴板访问，请改用文件下载')
    }
  }

  const syncMissingApiKeys = async () => {
    const ids = accounts
      .filter((account) => account.status === 'completed' && !account.apiKey)
      .map((account) => account.id)
    if (ids.length === 0) {
      message.info('当前范围的 API Key 已齐全')
      return
    }

    setSyncingKeys(true)
    try {
      const result = await accountApi.syncApiKeys(ids)
      await fetchData()
      if (result.failed > 0) {
        message.warning(`已补齐 ${result.synced} 个，失败 ${result.failed} 个`)
      } else {
        message.success(`已补齐 ${result.synced} 个 API Key`)
      }
    } catch (err) {
      message.error(errorMessage(err))
    } finally {
      setSyncingKeys(false)
    }
  }

  const columns: ColumnsType<Account> = [
    { title: '用户名', dataIndex: 'username', key: 'username', width: 150, ellipsis: true },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (status: string) => <StatusTag status={status} />,
    },
    {
      title: 'API Key',
      dataIndex: 'apiKey',
      key: 'apiKey',
      render: (value: string | null) => (
        <Space.Compact style={{ width: '100%' }}>
          <Input
            value={value ?? ''}
            readOnly
            placeholder="暂无数据"
            style={{ fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12 }}
          />
          <Button
            icon={<CopyOutlined />}
            disabled={!value}
            onClick={() => {
              if (!value) return
              void navigator.clipboard
                .writeText(value)
                .then(() => message.success('API Key 已复制'))
                .catch(() => message.error('剪贴板不可用'))
            }}
          />
        </Space.Compact>
      ),
    },
    {
      title: 'Cookie Token',
      dataIndex: 'cookieToken',
      key: 'cookieToken',
      render: (value: string | null) => (
        <Space.Compact style={{ width: '100%' }}>
          <Input
            value={value ?? ''}
            readOnly
            placeholder="暂无数据"
            style={{ fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12 }}
          />
          <Button
            icon={<CopyOutlined />}
            disabled={!value}
            onClick={() => {
              if (!value) return
              void navigator.clipboard
                .writeText(value)
                .then(() => message.success('Cookie Token 已复制'))
                .catch(() => message.error('剪贴板不可用'))
            }}
          />
        </Space.Compact>
      ),
    },
  ]

  return (
    <div>
      <Card style={{ marginBottom: 16 }}>
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <div>
            <Text strong style={{ marginInlineEnd: 12 }}>
              导出范围
            </Text>
            <Radio.Group
              value={scope}
              onChange={(e) => setScope(e.target.value as ScopeOption)}
              optionType="button"
              buttonStyle="solid"
              options={[
                { label: '已完成', value: 'completed' },
                { label: '待处理', value: 'pending' },
                { label: '失败', value: 'failed' },
                { label: '全部', value: 'all' },
              ]}
            />
          </div>

          <Checkbox checked={includeSecrets} onChange={(e) => setIncludeSecrets(e.target.checked)}>
            包含 Google 密码、TOTP 密钥与辅助邮箱
          </Checkbox>

          {includeSecrets && (
            <Alert
              type="warning"
              showIcon
              message="导出文件将包含明文密码和 TOTP 密钥，请妥善保管。"
            />
          )}

          <Space wrap>
            <Button type="primary" icon={<DownloadOutlined />} onClick={() => handleDownload('csv')}>
              下载 CSV
            </Button>
            <Button icon={<DownloadOutlined />} onClick={() => handleDownload('json')}>
              下载 JSON
            </Button>
            <Button icon={<DownloadOutlined />} onClick={() => handleDownload('txt')}>
              下载 TXT（账号----密码----密钥）
            </Button>
            <Button icon={<CopyOutlined />} onClick={() => void copyAll('apiKey')}>
              复制全部 API Key
            </Button>
            <Button
              icon={<KeyOutlined />}
              loading={syncingKeys}
              disabled={!accounts.some((account) => account.status === 'completed' && !account.apiKey)}
              onClick={() => void syncMissingApiKeys()}
            >
              自动补齐 API Key
            </Button>
            <Button icon={<CopyOutlined />} onClick={() => void copyAll('cookieToken')}>
              复制全部 Cookie
            </Button>
            <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void fetchData()}>
              刷新
            </Button>
          </Space>

          <Paragraph type="secondary" style={{ marginBottom: 0, fontSize: 12 }}>
            CSV 带 UTF-8 BOM，Excel 直接打开不会乱码。TXT 的格式与批量导入完全一致，可直接回灌。
          </Paragraph>
        </Space>
      </Card>

      <Table
        columns={columns}
        dataSource={accounts}
        loading={loading}
        rowKey="id"
        size="middle"
        pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }}
        locale={{ emptyText: <Empty description="当前范围没有数据" /> }}
      />
    </div>
  )
}

export default ExportData
