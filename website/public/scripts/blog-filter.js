const filterButtons = [...document.querySelectorAll('[data-blog-filter]')];
const storyCards = [...document.querySelectorAll('[data-blog-card]')];
const storyCount = document.querySelector('[data-blog-count]');

for (const button of filterButtons) {
  button.addEventListener('click', () => {
    const selectedCategory = button.dataset.blogFilter;
    let visibleStories = 0;

    for (const candidate of filterButtons) {
      candidate.setAttribute('aria-pressed', String(candidate === button));
    }

    for (const card of storyCards) {
      const visible = selectedCategory === 'all' || card.dataset.category === selectedCategory;
      card.hidden = !visible;
      if (visible) visibleStories += 1;
    }

    if (storyCount) {
      storyCount.textContent = `${visibleStories} ${visibleStories === 1 ? 'story' : 'stories'}`;
    }
  });
}
