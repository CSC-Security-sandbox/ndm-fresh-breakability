import "./App.css";

function App() {
  return (
    <div className="bg-blue-500 text-white p-4">
      <h1 className="text-2xl font-bold">Hello World</h1>
      <p className="text-sm">This is a paragraph</p>
      <button className="bg-red-500 text-white p-2 rounded-md">Click me</button>
      <div className="bg-green-500 text-white p-2 rounded-md">
        <h2 className="text-xl font-bold">Hello World</h2>
        <p className="text-sm">This is a paragraph</p>
      </div>
    </div>
  );
}

export default App;
