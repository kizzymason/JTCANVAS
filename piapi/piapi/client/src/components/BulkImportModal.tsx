import React, { useEffect, useMemo, useState } from 'react'
import { Alert, App, Button, Input, Modal, Space, Statistic, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { accountApi, errorMessage } from '../services/api'
import type { BulkPreview, ParseError } from '../types'

const { Paragraph, Text } = Typography
const { TextArea } = Input

const PLACEHOLDER = `每行一个 Google 账号，字段用 ---- 分隔：

user@example.org|password|recovery@gmail.com
user@example.org----password----BASE32TOTP----recovery@gmail.com

也支持 |、Tab、分号、逗号作为分隔符；# 开头的行会被忽略。`

interface Props {
  open: boolean
  onClose: () => void
  onImported: () => void
}

const errorColumns: ColumnsType<ParseError> = [
  { title: '行号', dataIndex: 'line', key: 'line', width: 70 },
  { title: '原始内容', dataIndex: 'raw', key: 'raw', ellipsis: true },
  {
    title: '原因',
    dataIndex: 'error',
    key: 'error',
    width: 320,
    render: (text: string) => <Text type="danger">{text}</Text>,
  },
]

const BulkImportModal: React.FC<Props> = ({ open, onClose, onImported }) => {
  const { message } = App.useApp()
  const [text, setText] = useState('')
  const [preview, setPreview] = useState<BulkPreview | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    if (!open) {
      setText('')
      setPreview(null)
    }
  }, [open])

  // Debounced so every keystroke does not hit the parser endpoint.
  useEffect(() => {
    if (!open || !text.trim()) {
      setPreview(null)
      return
    }
    setPreviewing(true)
    const timer = window.setTimeout(() => {
      accountApi
        .bulkPreview(text)
        .then(setPreview)
        .catch((err) => message.error(errorMessage(err)))
        .finally(() => setPreviewing(false))
    }, 350)

    return () => window.clearTimeout(timer)
  }, [text, open, message])

  const canImport = useMemo(() => (preview?.valid ?? 0) > 0 && !importing, [preview, importing])

  const handleImport = async () => {
    setImporting(true)
    try {
      const result = await accountApi.bulkImport(text)
      message.success(
        `导入完成：新增 ${result.inserted}，更新 ${result.updated}，未变 ${result.skipped}，拒绝 ${result.rejected}`,
      )
      onImported()
      onClose()
    } catch (err) {
      message.error(errorMessage(err))
    } finally {
      setImporting(false)
    }
  }

  return (
    <Modal
      title="批量导入 Google 账号"
      open={open}
      onCancel={onClose}
      width={860}
      destroyOnClose
      footer={[
        <Button key="cancel" onClick={onClose}>
          取消
        </Button>,
        <Button key="import" type="primary" loading={importing} disabled={!canImport} onClick={handleImport}>
          导入 {preview?.valid ? `${preview.valid} 个账号` : ''}
        </Button>,
      ]}
    >
      <Paragraph type="secondary" style={{ marginTop: 0 }}>
        第一列必须是完整 Google 主账号邮箱。第三列会自动识别：含 <Text code>@</Text> 时是辅助邮箱，
        否则是 base32 TOTP。
        两者都有时使用四列：
        <Text code>主账号邮箱----密码----TOTP----辅助邮箱</Text>。已存在账号会更新凭据，不会重复创建。
      </Paragraph>

      <TextArea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={PLACEHOLDER}
        autoSize={{ minRows: 8, maxRows: 14 }}
        style={{ fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 13 }}
      />

      {preview && (
        <div style={{ marginTop: 16 }}>
          <Space size="large" style={{ marginBottom: 12 }}>
            <Statistic title="识别行数" value={preview.total} valueStyle={{ fontSize: 20 }} />
            <Statistic
              title="有效账号"
              value={preview.valid}
              valueStyle={{ fontSize: 20, color: '#52c41a' }}
            />
            <Statistic
              title="无法解析"
              value={preview.errors.length}
              valueStyle={{ fontSize: 20, color: preview.errors.length ? '#ff4d4f' : undefined }}
            />
          </Space>

          {preview.valid > 0 && (
            <Space size={[4, 4]} wrap style={{ marginBottom: 12 }}>
              {preview.preview.map((item) => (
                <Tag key={item.username} color={item.recoveryEmail ? 'purple' : 'blue'}>
                  {item.username} · {item.recoveryEmail ? '辅助邮箱' : 'TOTP'}
                </Tag>
              ))}
              {preview.valid > preview.preview.length && (
                <Tag>还有 {preview.valid - preview.preview.length} 个…</Tag>
              )}
            </Space>
          )}

          {preview.errors.length > 0 && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message={`${preview.errors.length} 行无法解析，导入时会被跳过`}
            />
          )}

          {preview.errors.length > 0 && (
            <Table
              size="small"
              rowKey="line"
              columns={errorColumns}
              dataSource={preview.errors}
              pagination={preview.errors.length > 5 ? { pageSize: 5 } : false}
            />
          )}
        </div>
      )}

      {previewing && !preview && <Paragraph type="secondary">正在解析…</Paragraph>}
    </Modal>
  )
}

export default BulkImportModal
