import HistoryWallScene from "../f5/historyWall/HistoryWallScene";

// Creativity Currents is the shared cabin sea-chart opened on the Creativity
// map. (Switch to the Influence map with the in-scene toggle.)
export default function CreativityCurrents(props) {
  return <HistoryWallScene initialMode="creativity" {...props} />;
}
