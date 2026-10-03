const myHeading = document.getElementById('theBestCity');
const toggleList = document.getElementById('toggleButtom');
const listDiv = document.getElementById('hideContent');

myHeading.addEventListener('click', () => {
  myHeading.style.color = 'red';
  myHeading.textContent = 'Have a Good Time!.';
});

toggleList.addEventListener('click', () => {
  if (hideContent.style.display == 'none') {
    toggleList.textContent = 'Hide list';
    hideContent.style.display = 'flex';
    hideContent.style.flexWrap = 'wrap'; 

  } else {
    toggleList.textContent = 'Show list';                        
    hideContent.style.display = 'none';
  }                         
});