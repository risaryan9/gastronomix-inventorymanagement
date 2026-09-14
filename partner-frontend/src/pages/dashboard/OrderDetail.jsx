import { useParams } from 'react-router-dom'
import PagePlaceholder from '../../dashboard/PagePlaceholder.jsx'

export default function OrderDetail() {
  const { orderId } = useParams()
  return <PagePlaceholder title={`Order ${orderId}`} />
}
