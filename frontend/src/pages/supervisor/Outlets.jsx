import OutletsPageBase from '../../components/outlets/OutletsPageBase'

const Outlets = ({ isBpOperator = false }) => (
  <OutletsPageBase role={isBpOperator ? 'bp_operator' : 'supervisor'} />
)

export default Outlets
