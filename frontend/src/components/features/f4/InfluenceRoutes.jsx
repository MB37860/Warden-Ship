import HistoryWallScene from "../f5/historyWall/HistoryWallScene";

// Influence Routes is the shared cabin sea-chart opened on the Influence map.
// (Switch to the Creativity map with the in-scene toggle.)
export default function InfluenceRoutes(props) {
  return <HistoryWallScene initialMode="influence" {...props} />;
}
