import React, { useState } from 'react'
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Empty,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import { DeleteOutlined, PlusOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { errorMessage, settingsApi } from '../services/api'
import type { EgressInfo, ProxyEntry, ProxyPool, ProxyStrategy, ProxyTestResult } from '../types'

const { Paragraph, Text } = Typography
const { TextArea } = Input

const STRATEGY_OPTIONS: Array<{ value: ProxyStrategy; label: string; hint: string }> = [
  {
    value: 'per-account',
    label: '按账号固定',
    hint: '同一个账号整轮注册都走同一条代理，OAuth 过程中出口 IP 不会变。默认用这个。',
  },
  { value: 'round-robin', label: '轮询', hint: '按顺序依次使用，负载最均匀。' },
  { value: 'random', label: '随机', hint: '每次独立随机挑一条。' },
]

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `proxy-${crypto.randomUUID().slice(0, 8)}`
  }
  return `proxy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

/**
 * Accepts the three shapes vendors hand out:
 * `host:port:user:pass`, `user:pass@host:port` and a full `scheme://…` URL.
 */
export function parseProxyLine(line: string): string | null {
  const value = line.trim()
  if (!value) return null

  if (/^\w+:\/\//.test(value)) return value

  const parts = value.split(':')
  if (parts.length === 4 && /^\d+$/.test(parts[1])) {
    const [host, port, user, pass] = parts
    return `http://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}`
  }

  return `http://${value}`
}

interface Props {
  value: ProxyPool
  onChange: (pool: ProxyPool) => void
  /** Persists the whole settings form; the server tests what is stored, not what is typed. */
  onPersist: () => Promise<void>
}

const ProxyPoolCard: React.FC<Props> = ({ value, onChange, onPersist }) => {
  const { message } = App.useApp()
  const [results, setResults] = useState<Record<string, ProxyTestResult>>({})
  const [testingAll, setTestingAll] = useState(false)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [checkingEgress, setCheckingEgress] = useState(false)
  const [egress, setEgress] = useState<EgressInfo | null>(null)
  const [egressKey, setEgressKey] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')

  const usable = value.entries.filter((entry) => entry.enabled && entry.url.trim())

  const patchEntry = (id: string, patch: Partial<ProxyEntry>) => {
    onChange({
      ...value,
      entries: value.entries.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
    })
  }

  const addEntry = () => {
    const entry: ProxyEntry = {
      id: newId(),
      label: `代理 ${value.entries.length + 1}`,
      url: '',
      enabled: true,
    }
    onChange({ ...value, entries: [...value.entries, entry] })
  }

  const removeEntry = (id: string) => {
    const entries = value.entries.filter((entry) => entry.id !== id)
    // Turning the pool off alongside the last entry avoids an "on but direct"
    // state that the server would silently correct on the next save anyway.
    onChange({ ...value, entries, enabled: entries.length > 0 && value.enabled })
  }

  const handleImport = () => {
    const added: ProxyEntry[] = []
    importText.split('\n').forEach((line, index) => {
      const url = parseProxyLine(line)
      if (url) {
        added.push({ id: newId(), label: `导入 ${value.entries.length + index + 1}`, url, enabled: true })
      }
    })

    if (added.length === 0) {
      message.warning('没有解析出任何代理')
      return
    }

    onChange({ ...value, entries: [...value.entries, ...added] })
    setImportText('')
    setImportOpen(false)
    message.success(`已添加 ${added.length} 条，记得点「保存设置」`)
  }

  const runTest = async (id?: string) => {
    if (id) setTestingId(id)
    else setTestingAll(true)

    try {
      await onPersist()
      if (id) {
        const result = await settingsApi.testProxy(id)
        setResults((prev) => ({ ...prev, [id]: result }))
      } else {
        const list = await settingsApi.testProxyPool()
        setResults(Object.fromEntries(list.map((result) => [result.id, result])))
        const ok = list.filter((result) => result.ok).length
        message.info(`${ok}/${list.length} 条可用`)
      }
    } catch (err) {
      message.error(errorMessage(err))
    } finally {
      setTestingId(null)
      setTestingAll(false)
    }
  }

  const checkEgress = async () => {
    setCheckingEgress(true)
    try {
      await onPersist()
      setEgress(await settingsApi.egressIp(egressKey.trim() || undefined))
    } catch (err) {
      message.error(errorMessage(err))
    } finally {
      setCheckingEgress(false)
    }
  }

  return (
    <Card
      title="代理池"
      style={{ marginBottom: 16 }}
      extra={
        <Space>
          <Text type="secondary">{value.enabled ? `已开启 · ${usable.length} 条可用` : '已关闭 · 直连'}</Text>
          <Switch
            checked={value.enabled}
            checkedChildren="开"
            unCheckedChildren="关"
            onChange={(enabled) => {
              if (enabled && usable.length === 0) {
                message.warning('先添加并启用至少一条代理')
                return
              }
              onChange({ ...value, enabled })
            }}
          />
        </Space>
      }
    >
      <Paragraph type="secondary" style={{ marginTop: 0 }}>
        关闭时全部走直连。地址支持 <Text code>http://user:pass@host:port</Text> 与{' '}
        <Text code>socks5://host:port</Text>。地址里写 <Text code>{'{session}'}</Text> 会被替换成账号专属的
        会话标识——轮换型住宅代理必须这样写，否则每个请求都换一个出口 IP，Google OAuth 中途换 IP
        容易触发额外身份验证。
      </Paragraph>

      <Row gutter={16} style={{ marginBottom: 12 }}>
        <Col xs={24}>
          <Text strong>分配策略</Text>
          <Select
            style={{ width: '100%', marginTop: 6 }}
            value={value.strategy}
            onChange={(strategy: ProxyStrategy) => onChange({ ...value, strategy })}
            options={STRATEGY_OPTIONS.map((option) => ({
              value: option.value,
              label: option.label,
            }))}
          />
          <Text type="secondary" style={{ fontSize: 12 }}>
            {STRATEGY_OPTIONS.find((option) => option.value === value.strategy)?.hint}
          </Text>
        </Col>
      </Row>

      {value.enabled && usable.length === 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="代理池是开的，但没有可用条目，实际仍然是直连"
        />
      )}

      <Table<ProxyEntry>
        size="small"
        rowKey="id"
        pagination={false}
        dataSource={value.entries}
        scroll={{ x: 960 }}
        locale={{ emptyText: <Empty description="还没有代理，点下面的「添加代理」" /> }}
        style={{ marginBottom: 12 }}
        columns={[
          {
            title: '启用',
            dataIndex: 'enabled',
            width: 70,
            render: (enabled: boolean, entry) => (
              <Switch
                size="small"
                checked={enabled}
                onChange={(next) => patchEntry(entry.id, { enabled: next })}
              />
            ),
          },
          {
            title: '名称',
            dataIndex: 'label',
            width: 210,
            render: (label: string, entry) => (
              <Input
                size="small"
                value={label}
                placeholder="备注"
                onChange={(e) => patchEntry(entry.id, { label: e.target.value })}
              />
            ),
          },
          {
            title: '代理地址',
            dataIndex: 'url',
            render: (url: string, entry) => (
              <Input
                size="small"
                value={url}
                placeholder="http://user-sessid-{session}:pass@gateway:9999"
                style={{ fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12 }}
                onChange={(e) => patchEntry(entry.id, { url: e.target.value })}
              />
            ),
          },
          {
            title: '出口',
            width: 210,
            render: (_, entry) => {
              const result = results[entry.id]
              if (!result) return <Text type="secondary">未测试</Text>
              if (!result.ok) {
                return (
                  <Tooltip title={result.error}>
                    <Tag color="red">失败</Tag>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {result.error?.slice(0, 40)}
                    </Text>
                  </Tooltip>
                )
              }
              return (
                <Tooltip title={result.org ?? ''}>
                  <Tag color="green">{result.latencyMs} ms</Tag>
                  <Text style={{ fontSize: 12 }}>
                    {result.ip} {result.country ?? ''}
                  </Text>
                </Tooltip>
              )
            },
          },
          {
            title: '操作',
            width: 120,
            render: (_, entry) => (
              <Space size={4}>
                <Button
                  size="small"
                  loading={testingId === entry.id}
                  disabled={!entry.url.trim()}
                  onClick={() => void runTest(entry.id)}
                >
                  测试
                </Button>
                <Button
                  size="small"
                  danger
                  type="text"
                  icon={<DeleteOutlined />}
                  onClick={() => removeEntry(entry.id)}
                />
              </Space>
            ),
          },
        ]}
      />

      <Space wrap>
        <Button icon={<PlusOutlined />} onClick={addEntry}>
          添加代理
        </Button>
        <Button onClick={() => setImportOpen(true)}>批量导入</Button>
        <Button
          icon={<ThunderboltOutlined />}
          loading={testingAll}
          disabled={value.entries.length === 0}
          onClick={() => void runTest()}
        >
          测试全部
        </Button>
        <Input
          style={{ width: 150 }}
          value={egressKey}
          onChange={(e) => setEgressKey(e.target.value)}
          placeholder="account-1"
          suffix={
            <Tooltip title="留空则用一个通用标识。填 account-<账号ID> 可以验证那个账号实际会从哪个 IP 出去。">
              <Text type="secondary" style={{ fontSize: 12 }}>
                模拟
              </Text>
            </Tooltip>
          }
        />
        <Button loading={checkingEgress} onClick={() => void checkEgress()}>
          检测浏览器出口 IP
        </Button>
      </Space>

      {egress && (
        <Alert
          type="info"
          showIcon
          style={{ marginTop: 12 }}
          message={`${egress.profileKey} 的浏览器出口 IP：${egress.ip}（${egress.org ?? '归属未知'}，${egress.city ?? ''} ${egress.country ?? ''}）`}
          description={
            <>
              {egress.proxyConfigured ? (
                <>
                  当前走代理池条目 <Text code>{egress.proxyLabel}</Text>。
                </>
              ) : (
                '代理池未生效，当前是直连。'
              )}{' '}
              这一项真的启动了 Chromium，和批量注册走完全相同的链路，比上面的「测试」更可信。
              如果归属显示的是机房 / VPS 服务商（名字里常带 LTD、Cloud、Hosting、IDC），送免费额度的站点大概率直接拒绝。
            </>
          }
        />
      )}

      <Modal
        title="批量导入代理"
        open={importOpen}
        onOk={handleImport}
        onCancel={() => setImportOpen(false)}
        okText="导入"
        cancelText="取消"
      >
        <Paragraph type="secondary">
          一行一条，三种写法都认：
          <br />
          <Text code>host:port:user:pass</Text>
          <br />
          <Text code>user:pass@host:port</Text>
          <br />
          <Text code>http://user:pass@host:port</Text>
        </Paragraph>
        <TextArea
          rows={8}
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          placeholder={'0qbhqrhx.pr.thordata.net:9999:td-customer-xxx:yyy\nhttp://user:pass@1.2.3.4:8080'}
          style={{ fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12 }}
        />
      </Modal>
    </Card>
  )
}

export default ProxyPoolCard
