import React, { Children } from "react";

type RenderEachProps<T> = {
  renderList: T[];
  renderItem: (item: T, index: number) => React.ReactNode;
};

const RenderEach = <T,>({ renderItem, renderList }: RenderEachProps<T>) => {
  return Children.toArray(
    renderList?.map((item: T, index: number) => renderItem(item, index))
  );
};

export default RenderEach;
